import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCreativeSessionStore, createProviderSettingsStore } from '../local-api.mjs';
import { mergeCharacterProfiles } from '../src/character-profile-merge.ts';
import { characterPresence, changeCharacterRoster, buildCharacterCatalog } from '../character-library.mjs';

const profile = (name = '阿岚', key = 'C01') => ({ profileKey: key, name, aliases: [], introduction: `${name}送信。`, identity: '信使', storyRole: '送信人', personality: ['认真'], motivation: '完成送信', relationships: [], physicalKnownFacts: ['眉尾有疤'], wardrobeKnownFacts: ['青色长衣'], designOpenQuestions: [], sourceSceneKeys: ['S01'], sourceFacts: [{ fact: '送信', sceneKey: 'S01', evidence: `${name}走进院子。` }] });
const script = number => ({ title: `第${number}集`, workType: 'series', episodeNumber: number, durationSec: 15, seriesPlan: [1,2,3].map(episodeNumber => ({ episodeNumber })), characters: [{ name: '阿岚', role: '信使', goal: '送信' }], scenes: [{ location: '院子', time: '白天', summary: '送信', blocks: [{ type: 'action', text: '阿岚走进院子。' }, { type: 'dialogue', speaker: '阿岚', text: '小禾明天才来。' }] }] });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'prism-character-library-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const filePath = join(root, 'session.json'); const store = createCreativeSessionStore({ filePath });
  const first = store.save({ state: { step: 'workspace', workType: 'series', projectName: '送信', activeStage: '角色', selectedStyleId: 'ancient-live-action', ideaScript: script(1), episodeScripts: [1,2,3].map(n => ({ episodeNumber: n, status: 'complete', script: script(n) })), scriptApproval: 'approved', characterStatus: 'complete', characterProfiles: [profile(), profile('小禾','C02')], characterApproval: 'approved', characterAssetsApproval: 'approved', characterImages: [{ profileKey:'C01',name:'阿岚',status:'complete',imageUrl:'/api/generated-images/first.png' }], characterTurnarounds: [{ profileKey:'C01',name:'阿岚',status:'complete',imageUrl:'/api/generated-images/first-views.png' }] } });
  const act = input => { const s = store.load(); return store.changeCharacters({ projectId:s.id, expectedRevision:s.revision, ...input }); };
  return { store, first, act, filePath, root };
}

test('scene participation separates a mention from an acting or voice character', () => {
  assert.equal(characterPresence(script(1),profile()),'visual');
  assert.equal(characterPresence(script(1),profile('小禾')),'candidate');
  assert.equal(characterPresence({scenes:[{blocks:[{type:'os',speaker:'小禾',text:'门开了'}]}]},profile('小禾')),'voice');
});

test('legacy reconciliation archives unused people and preserves every draft resource', t => {
  const {store,act}=fixture(t);
  const previous=store.load();
  store.save({state:{...previous.state,characterAssetsApproval:'draft',characterImages:[...previous.state.characterImages,{profileKey:'C02',name:'小禾',status:'complete',imageUrl:'/api/generated-images/draft.png'}]}});
  const next=act({action:'reconcile'});
  assert.deepEqual(next.state.characterProfiles.map(p=>p.name),['阿岚']);
  const archived=next.state.characterLibraryHistory.find(e=>e.profile.name==='小禾'&&e.resources.characterImages.length);
  assert.equal(archived.resources.characterImages[0].imageUrl,'/api/generated-images/draft.png');
  assert.equal(next.state.characterError,'');
  assert.ok(store.characterCatalog().some(e=>e.profile.name==='小禾'));
});

test('second episode automatically reuses approved identity and images without changing first episode', t => {
  const {store,act,first,root}=fixture(t);
  const approved=act({action:'approve-profiles'});act({action:'approve-assets'});
  const firstBytes=readFileSync(join(root,'projects',`${first.id}.json`),'utf8');
  const current=store.load();const second=store.openEpisode({projectId:current.id,expectedRevision:current.revision,episodeNumber:2});
  store.save({state:{...second.state,characterStatus:'complete',characterProfiles:[{...profile(),introduction:'阿岚找回信件。',motivation:'找回信件',physicalKnownFacts:['另一张脸']} ]}});
  const ready=act({action:'approve-profiles'});
  assert.equal(ready.state.characterProfiles[0].libraryBinding.identityId,approved.state.characterProfiles[0].libraryBinding.identityId);
  assert.equal(ready.state.characterImages[0].imageUrl,'/api/generated-images/first.png');
  assert.deepEqual(ready.state.characterProfiles[0].physicalKnownFacts,['眉尾有疤']);
  assert.equal(ready.state.characterProfiles[0].motivation,'找回信件');
  assert.equal(firstBytes,readFileSync(join(root,'projects',`${first.id}.json`),'utf8'));
});

test('new character imports without an existing target; repeat import is rejected without mutation', t=>{
  const {store,act}=fixture(t);act({action:'reconcile'});
  const entry=store.characterCatalog().find(e=>e.profile.name==='小禾');
  const imported=act({action:'import',assetId:entry.id});
  assert.equal(imported.state.characterProfiles.length,2);
  assert.deepEqual(imported.state.characterProfiles[1].sourceFacts,entry.profile.sourceFacts);
  assert.throws(()=>act({action:'import',assetId:entry.id}),/已有/);
  assert.deepEqual(store.load(),imported);
});

test('remove, save, reopen and restore retain identity and approved images',t=>{
  const {store,act,filePath}=fixture(t);act({action:'approve-profiles'});act({action:'approve-assets'});
  const identity=store.load().state.characterProfiles[0].libraryBinding.identityId;
  act({action:'remove',profileKey:'C01'});
  const reopened=createCreativeSessionStore({filePath});const current=reopened.load();
  const entry=reopened.characterCatalog().find(e=>e.identityId===identity&&e.image);
  const restored=reopened.changeCharacters({projectId:current.id,expectedRevision:current.revision,action:'import',assetId:entry.id});
  assert.equal(restored.state.characterProfiles[0].libraryBinding.identityId,identity);
  assert.equal(restored.state.characterImages[0].imageUrl,'/api/generated-images/first.png');
});

test('new look preserves the old snapshot, clears the appearance pair and stales affected outputs',t=>{
  const {store,act}=fixture(t);act({action:'approve-profiles'});act({action:'approve-assets'});
  const s=store.load();store.save({state:{...s.state,storyboardSegments:[{segmentKey:'SEG001',characters:['阿岚']},{segmentKey:'SEG002',characters:['旁人']}],videoPrompts:[{segmentKey:'SEG001',status:'complete',prompt:'old'},{segmentKey:'SEG002',status:'complete',prompt:'other'}],shotVideoTasks:[{segmentKey:'SEG001',status:'awaiting_review',outputPaths:['old.mp4']}],postProduction:{...s.state.postProduction,roughCut:{status:'complete',videoUrl:'rough.mp4'}}}});
  const next=act({action:'new-look',profileKey:'C01',name:'雨衣',description:'棕色雨衣'});
  assert.deepEqual(next.state.characterImages,[]);assert.deepEqual(next.state.characterTurnarounds,[]);
  assert.ok(next.state.characterLibraryHistory.some(e=>e.image?.imageUrl==='/api/generated-images/first.png'));
  assert.equal(next.state.videoPrompts[0].status,'stale');assert.equal(next.state.videoPrompts[1].status,'complete');
  assert.equal(next.state.shotVideoTasks[0].outputPaths[0],'old.mp4');assert.equal(next.state.shotVideoTasks[0].stale,true);
  assert.equal(next.state.postProduction.roughCut.status,'stale');
});

test('stale project requests and live generation block roster writes',t=>{
  const {store,act,first}=fixture(t);
  assert.throws(()=>store.changeCharacters({projectId:first.id,expectedRevision:0,action:'remove',profileKey:'C01'}));
  const s=store.load();store.save({state:{...s.state,characterImageStatus:'running'}});
  const before=store.load();assert.throws(()=>act({action:'remove',profileKey:'C01'}),/任务正在执行/);assert.deepEqual(store.load(),before);
});

test('same names in another work and future episodes are not automatically bound',()=>{
  const current={id:'current',series:{rootProjectId:'series',episodeNumber:1},state:{ideaScript:script(1),characterProfiles:[profile()],characterStatus:'complete',characterApproval:'draft',selectedStyleId:'ancient-live-action'}};
  const unrelated={id:'other',state:{...current.state,characterApproval:'approved'}};
  const future={id:'future',series:{rootProjectId:'series',episodeNumber:3},state:{...current.state,characterApproval:'approved',characterAssetsApproval:'approved',characterImages:[{profileKey:'C01',status:'complete',imageUrl:'future.png'}]}};
  const next=changeCharacterRoster(current,{action:'approve-profiles'},buildCharacterCatalog([unrelated,future]));
  assert.equal(next.characterProfiles[0].libraryBinding.reused,undefined);assert.deepEqual(next.characterImages,undefined);
});

test('reordered agent output and manual additions retain local keys and identities',()=>{
  const old=[{...profile('阿岚','C01'),libraryBinding:{identityId:'person-a',assetId:'asset-a'}},{...profile('小禾','C02'),manuallyAdded:true}];
  const merged=mergeCharacterProfiles(old,[profile('新人','C01'),{...profile('阿岚','C02'),physicalKnownFacts:['另一张脸']}]);
  assert.equal(merged.find(p=>p.name==='阿岚').profileKey,'C01');
  assert.equal(merged.find(p=>p.name==='小禾').profileKey,'C02');
  assert.equal(merged.find(p=>p.name==='新人').profileKey,'C03');
  assert.deepEqual(merged.find(p=>p.name==='阿岚').physicalKnownFacts,['眉尾有疤']);
});

test('automatic save is idempotent and preserves the full role history',t=>{
  const {store,act}=fixture(t);act({action:'approve-profiles'});act({action:'approve-assets'});
  const size=store.load().state.characterLibraryHistory.length;
  for(let i=0;i<15;i++)store.save({state:store.load().state});
  assert.equal(store.load().state.characterLibraryHistory.length,size);
});

test('voice roles and real generation errors are preserved through reconciliation',t=>{
  const {store,act}=fixture(t);
  const added=act({action:'new',name:'报幕者',description:'用声音报幕',participation:'voice'});
  store.save({state:{...added.state,characterError:'服务连接失败，请检查配置'}});
  const next=act({action:'reconcile'});
  assert.equal(next.state.characterProfiles.find(p=>p.name==='报幕者').participation,'voice');
  assert.equal(next.state.characterError,'服务连接失败，请检查配置');
});

test('switching to an image-only appearance clears an old auxiliary reference',t=>{
  const {store,act}=fixture(t);act({action:'approve-profiles'});act({action:'approve-assets'});
  const source=store.characterCatalog().find(e=>e.image&&e.profile.name==='阿岚');
  const custom={...source,id:'image-only',turnaround:undefined,image:{...source.image,imageUrl:'/api/generated-images/other.png'}};
  const next=changeCharacterRoster(store.load(),{action:'import',profileKey:'C01',assetId:'image-only'},[custom]);
  assert.deepEqual(next.characterTurnarounds,[]);
  assert.equal(next.characterImages[0].imageUrl,'/api/generated-images/other.png');
});

test('new look submits its identity reference once through image editing',async t=>{
  const root=mkdtempSync(join(tmpdir(),'prism-character-look-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'identity.png'),'fixture');let edits=0;let plain=0;let agents=0;
  const store=createProviderSettingsStore({generatedImageDirectory:root,agentProviderFactory:()=>({generate(){agents++;throw Error('unused');}}),imageProviderFactory:()=>({submit(){plain++;throw Error('unused');}}),imageEditProviderFactory:()=>({async submit(request){edits++;assert.deepEqual(request.referenceMediaPaths,[join(root,'identity.png')]);assert.deepEqual(request.referenceAssetIds,['approved-look']);assert.match(request.prompt,/角色资产参考：图片1/u);return {status:'awaiting_review',outputPaths:[join(root,'new-look.png')]};}})});
  for(const kind of ['agent','image','image-edit'])store.configure({kind,apiKey:'fixture-key-12345',baseUrl:'https://fixture.invalid/v1',model:'fixture'});
  const request={profiles:[{...profile(),libraryBinding:{identityImageUrl:'/api/generated-images/identity.png',identityAssetId:'approved-look'}}],styleId:'ancient-live-action',prompts:[{profileKey:'C01',name:'阿岚',styleId:'ancient-live-action',prompt:'基础设定\n横版3:2人物资产板。\n画面内容与布局\n完整人物。\n负面词\n模糊'}]};
  const result=await store.runCharacterImages(request);
  assert.equal(result.images[0].status,'complete');assert.equal(edits,1);assert.equal(plain,0);assert.equal(agents,0);
  const broken={...request,profiles:[{...request.profiles[0],libraryBinding:{identityImageUrl:'/api/generated-images/missing.png'}}]};
  await assert.rejects(()=>store.runCharacterImages(broken),/没有找到/);assert.equal(edits,1);assert.equal(agents,0);
});

test('ambiguous approved images request a deliberate version choice',()=>{
  const current={id:'current',series:{rootProjectId:'series',episodeNumber:2},state:{ideaScript:script(2),characterProfiles:[profile()],characterStatus:'complete',characterApproval:'draft',selectedStyleId:'ancient-live-action'}};
  const base={id:'approved',identityId:'same-person',scopeId:'series',sourceProjectId:'ep1',episodeNumber:1,approved:true,imageApproved:true,lookId:'base',styleId:'ancient-live-action',profile:profile(),image:{profileKey:'C01',status:'complete',imageUrl:'/api/generated-images/a.png'}};
  const next=changeCharacterRoster(current,{action:'reconcile'},[base,{...base,id:'second',image:{...base.image,imageUrl:'/api/generated-images/b.png'}}]);
  assert.equal(next.characterProfiles[0].libraryBinding.selectionNeeded,true);
  assert.equal(next.characterProfiles[0].libraryBinding.reused,undefined);
});

test('adding an archived cast member stales segments that already name that person',t=>{
  const {store,act}=fixture(t);act({action:'reconcile'});
  const s=store.load();store.save({state:{...s.state,storyboardSegments:[{segmentKey:'SEG001',characters:['小禾']}],videoPrompts:[{segmentKey:'SEG001',status:'complete',prompt:'original'}]}});
  const entry=store.characterCatalog().find(e=>e.profile.name==='小禾');const next=act({action:'import',assetId:entry.id});
  assert.equal(next.state.videoPrompts[0].status,'stale');assert.equal(next.state.videoPrompts[0].prompt,'original');
});

test('editing appearance preserves approved history and invalidates only this role images',t=>{
  const {store,act}=fixture(t);act({action:'approve-profiles'});act({action:'approve-assets'});
  const s=store.load();const changed={...s.state.characterProfiles[0],wardrobeKnownFacts:['棕色长衣']};
  const next=act({action:'update-profile',profileKey:changed.profileKey,profile:changed});
  assert.deepEqual(next.state.characterImages,[]);assert.ok(next.state.characterLibraryHistory.some(e=>e.image?.imageUrl==='/api/generated-images/first.png'));
  assert.deepEqual(next.state.characterProfiles[0].wardrobeKnownFacts,['棕色长衣']);
  assert.ok(next.state.characterLibraryHistory.some(e=>e.imageApproved&&e.profile.wardrobeKnownFacts[0]==='青色长衣'));
  assert.equal(next.state.characterProfiles[0].libraryBinding.identityImageUrl,'/api/generated-images/first.png');
  assert.equal(next.state.characterApproval,'draft');assert.equal(next.state.activeStage,'角色');
});
