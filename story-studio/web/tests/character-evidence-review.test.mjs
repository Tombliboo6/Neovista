import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createCreativeSessionStore,localizeCharacterProfileValidationWarnings,toApprovedDomainScript} from '../local-api.mjs';
import {selectEpisodeCharacters} from '../src/episode-characters.ts';
const script={title:'门前',logline:'阿岚送信',endingHook:'门开了',durationSec:30,scenes:[{location:'门前',time:'白天',summary:'阿岚敲门。',blocks:[{type:'dialogue',speaker:'阿岚',text:'请收信。'}],dialogue:[{speaker:'旧角色',line:'旧稿对白'}]}],characters:[{name:'阿岚',role:'送信人',goal:'送信'},{name:'旧角色',role:'旧稿人物',goal:'等待'}]};
const profile={profileKey:'C01',name:'阿岚',aliases:[],introduction:'阿岚来送信。',identity:'送信人',storyRole:'主角',personality:['认真'],motivation:'送信',relationships:[],physicalKnownFacts:[],wardrobeKnownFacts:[],designOpenQuestions:[],sourceSceneKeys:['S01'],sourceFacts:[{fact:'请求收信',sceneKey:'S01',evidence:'请立刻收信。'}]};

test('warnings identify people, reasons and scenes without repeating a generic reassurance',()=>{
 const warnings=localizeCharacterProfileValidationWarnings(['profile 1 evidence is not verbatim in scene S01','profile 1 evidence is not verbatim in scene S02','profile 1 evidence is not verbatim in scene S01','profile 2 requires at least one source fact'],[profile,{name:'小禾'}]);
 assert.deepEqual(warnings,['阿岚：S01的引用未匹配剧本原句；S02的引用未匹配剧本原句。','小禾：尚未提供支持人物设定的剧本引用。']);
});

test('saved legacy warnings are recalculated without changing profiles or performing model work',t=>{
 const root=mkdtempSync(join(tmpdir(),'prism-profile-evidence-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const filePath=join(root,'session.json');const store=createCreativeSessionStore({filePath});
 const saved=store.save({state:{step:'start',ideaScript:script,characterProfiles:[profile],characterStatus:'complete'}});
 const legacy={...saved,state:{...saved.state,characterError:'第1项的剧本依据索引不完整；人物设定已保留，可继续审核，系统不会因此卡住角色阶段。'}};
 writeFileSync(filePath,JSON.stringify(legacy));const before=readFileSync(filePath,'utf8');
 const loaded=store.load();assert.equal(loaded.state.characterError,'阿岚：S01的引用未匹配剧本原句。');assert.deepEqual(loaded.state.characterProfiles,[profile]);assert.equal(readFileSync(filePath,'utf8'),before);
 const matching={...legacy,state:{...legacy.state,characterProfiles:[{...profile,sourceFacts:[{fact:'请求收信',sceneKey:'S01',evidence:'请收信。'}]}]}};
 writeFileSync(filePath,JSON.stringify(matching));assert.equal(store.load().state.characterError,'');
});

test('current character candidates and the Agent script agree on authoritative dialogue',()=>{
 const approved=toApprovedDomainScript(script);assert.deepEqual(approved.scenes[0].dialogue.map(x=>x.speakerName),['阿岚']);assert.deepEqual(selectEpisodeCharacters(script).map(x=>x.name),['阿岚']);
});

test('unrelated saved failures remain intact',t=>{
 const root=mkdtempSync(join(tmpdir(),'prism-profile-error-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const store=createCreativeSessionStore({filePath:join(root,'session.json')});
 const saved=store.save({state:{step:'start',ideaScript:script,characterProfiles:[profile],characterError:'服务商连接超时，请保留当前草稿。'}});
 assert.equal(saved.state.characterError,'服务商连接超时，请保留当前草稿。');
});
