import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCharacterProfileRequest,
  CHARACTER_PROFILE_SCHEMA_NAME,
  CharacterProfileValidationError,
  generateCharacterProfiles,
  validateCharacterProfileDraft
} from '../src/characters/profile-extraction.ts';
import { materializeCharacterProfileSet } from '../src/characters/profile-versioning.ts';

const script = {
  id: 'script-episode-1',
  version: 2,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T01:00:00.000Z',
  approval: 'approved',
  episodeId: 'episode-1',
  episodeVersion: 1,
  documentId: 'novel-1',
  documentVersion: 1,
  title: '雨夜背叛',
  logline: '张浩然在雨夜遭林无双逼迫，为守住人皇印选择自爆。',
  synopsis: '同门反目并争夺人皇印。',
  targetDurationSec: 105,
  estimatedDurationSec: 105,
  openingHook: '雨夜追杀。',
  endingHook: '林无双认定张浩然已死。',
  adaptationNotes: [],
  continuityOut: '张浩然和人皇印从现场消失。',
  scenes: [
    {
      id: 'script-episode-1-s01',
      sceneKey: 'S01',
      order: 1,
      heading: '外景·荒野·雨夜',
      location: '荒野',
      timeOfDay: '夜',
      interiorExterior: 'exterior',
      sourceSegmentIds: ['segment-1'],
      sourceStart: 0,
      sourceEnd: 400,
      sourceEvidence: ['我最信任的人，竟然会在最关键的时候捅我一刀'],
      purpose: '揭示同门背叛与夺宝动机。',
      durationSec: 60,
      action: '张浩然身中剧毒仍然站在雨中。林无双从扭曲的雨幕中现身，逼他交出人皇印。',
      dialogue: [
        {
          kind: 'dialogue',
          speakerName: '林无双',
          text: '交出人皇印，我可以给你个痛快的死法！',
          delivery: '冰冷而笃定'
        },
        {
          kind: 'dialogue',
          speakerName: '张浩然',
          text: '我纵然是死，也不会将这人皇印交给你的！',
          delivery: '愤怒而决绝'
        }
      ],
      soundCues: ['持续雨声'],
      transitionOut: 'continuous'
    },
    {
      id: 'script-episode-1-s02',
      sceneKey: 'S02',
      order: 2,
      heading: '外景·荒野·雨夜',
      location: '荒野',
      timeOfDay: '夜',
      interiorExterior: 'exterior',
      sourceSegmentIds: ['segment-2'],
      sourceStart: 400,
      sourceEnd: 887,
      sourceEvidence: ['张浩然，你终究还是死在了我的手中'],
      purpose: '完成自爆并留下生死悬念。',
      durationSec: 45,
      action: '张浩然击碎人皇印，身形随坍塌空间消失。林无双退到远处，确认现场无人。',
      dialogue: [
        {
          kind: 'dialogue',
          speakerName: '林无双',
          text: '张浩然，你终究还是死在了我的手中！',
          delivery: '冷哼后断言'
        }
      ],
      soundCues: ['石印炸裂声'],
      transitionOut: 'fade_to_black'
    }
  ]
};

const input = {
  script,
  requiredCharacterNames: ['张浩然', '林无双'],
  preferences: { language: 'zh-CN' }
};

const validDraft = {
  profiles: [
    {
      profileKey: 'C01',
      name: '张浩然',
      aliases: [],
      introduction: '宗门第一天才，身中剧毒仍拒绝交出人皇印，以自毁宝物和自身阻止林无双得逞。',
      identity: '被同门陷害追杀的宗门天才',
      storyRole: '本集主角与冲突承受者',
      personality: ['警觉', '重情', '决绝'],
      motivation: '守住人皇印并阻止背叛者得逞。',
      relationships: [
        { targetName: '林无双', relationship: '曾经最信任的同门，如今是追杀自己的背叛者。' }
      ],
      physicalKnownFacts: ['身中剧毒'],
      wardrobeKnownFacts: [],
      designOpenQuestions: ['年龄范围', '脸型与发型', '宗门服装样式'],
      sourceSceneKeys: ['S01', 'S02'],
      sourceFacts: [
        {
          fact: '拒绝交出人皇印。',
          sceneKey: 'S01',
          evidence: '我纵然是死，也不会将这人皇印交给你的！'
        },
        {
          fact: '击碎人皇印并从现场消失。',
          sceneKey: 'S02',
          evidence: '张浩然击碎人皇印，身形随坍塌空间消失'
        }
      ]
    },
    {
      profileKey: 'C02',
      name: '林无双',
      aliases: [],
      introduction: '张浩然曾经信任的同门，以宗门缉拿为名逼迫他交出人皇印，并在自爆后认定对方已死。',
      identity: '追杀张浩然并觊觎人皇印的同门',
      storyRole: '本集反派与冲突发起者',
      personality: ['冷酷', '算计', '自负'],
      motivation: '夺取人皇印并除掉竞争者。',
      relationships: [
        { targetName: '张浩然', relationship: '利用信任设局的同门与敌手。' }
      ],
      physicalKnownFacts: [],
      wardrobeKnownFacts: [],
      designOpenQuestions: ['年龄范围', '脸型与发型', '宗门服装样式'],
      sourceSceneKeys: ['S01', 'S02'],
      sourceFacts: [
        {
          fact: '逼迫张浩然交出人皇印。',
          sceneKey: 'S01',
          evidence: '交出人皇印，我可以给你个痛快的死法！'
        },
        {
          fact: '认定张浩然已经死亡。',
          sceneKey: 'S02',
          evidence: '张浩然，你终究还是死在了我的手中！'
        }
      ]
    }
  ]
};

test('narration dialogue does not require a visual character profile', () => {
  const scriptWithNarration = {
    ...script,
    scenes: script.scenes.map((scene, index) => index === 0 ? {
      ...scene,
      dialogue: [...scene.dialogue, { kind: 'dialogue', speakerName: '旁白', text: '雨越下越大。', delivery: '平静' }],
    } : scene),
  };
  assert.doesNotThrow(() => buildCharacterProfileRequest({ ...input, script: scriptWithNarration }));
});

test('character profile extraction starts only after an approved script', () => {
  const request = buildCharacterProfileRequest(input);
  assert.equal(request.operation, 'extract-character-profiles');
  assert.equal(request.schemaName, CHARACTER_PROFILE_SCHEMA_NAME);
  assert.equal(request.maxOutputTokens, 40_000);
  assert.match(request.instructions, /尚未选择全片画风/);
  assert.match(request.instructions, /不得替用户选择风格/);

  assert.throws(
    () => buildCharacterProfileRequest({ ...input, script: { ...script, approval: 'draft' } }),
    /must be approved/
  );
});

test('candidate coverage is decided by the character Agent and production director', () => {
  assert.doesNotThrow(
    () => buildCharacterProfileRequest({ ...input, requiredCharacterNames: ['张浩然'] })
  );
});

test('candidate entity labels reach semantic review instead of a keyword filter', () => {
  const request = buildCharacterProfileRequest({ ...input, requiredCharacterNames: ['张浩然', '环境'] });
  assert.deepEqual(request.input.requiredCharacterNames, ['张浩然', '环境']);
  assert.match(request.instructions, /依据它们在完整剧本中的真实功能/u);
});

test('valid character introductions cover required roles with verbatim script evidence', () => {
  assert.doesNotThrow(() => validateCharacterProfileDraft(validDraft, input));
});

test('character profile keeps usable content when evidence metadata drifts but still rejects unknown names', () => {
  const invented = structuredClone(validDraft);
  invented.profiles[0].sourceFacts[0].evidence = '张浩然拔出长剑';
  assert.deepEqual(validateCharacterProfileDraft(invented, input), ['profile 1 evidence is not verbatim in scene S01']);

  const unknown = { profiles: [{ ...structuredClone(validDraft.profiles[0]), name: '未提供的人物' }] };
  assert.throws(
    () => validateCharacterProfileDraft(unknown, input),
    CharacterProfileValidationError
  );
});

test('provider output is validated before character introductions are accepted', async () => {
  const fakeProvider = {
    id: 'fake-agent',
    async health() {
      return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' };
    },
    async generate() {
      return {
        output: validDraft,
        providerId: 'fake-agent',
        model: 'fake-model',
        status: 'completed',
        completedAt: '2026-08-21T00:00:00.000Z',
        elapsedMs: 1
      };
    }
  };

  const result = await generateCharacterProfiles(fakeProvider, input);
  assert.equal(result.output.profiles.length, 2);
});

test('provider bookkeeping drift is normalized without accepting invented evidence', async () => {
  const drifted = structuredClone(validDraft);
  drifted.profiles[0].profileKey = 'character-one';
  drifted.profiles[0].sourceSceneKeys = ['S02', 'S01'];
  drifted.profiles[0].sourceFacts[0].evidence = '我纵然是死，也不会将这人皇印交给你的';
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: new Date().toISOString() }; },
    async generate() { return { output: drifted, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 }; }
  };

  const result = await generateCharacterProfiles(fakeProvider, input);

  assert.equal(result.output.profiles[0].profileKey, 'C01');
  assert.equal(result.output.profiles[0].name, '张浩然');
  assert.deepEqual(result.output.profiles[0].sourceSceneKeys, ['S01', 'S02']);
});

test('character profile revisions preserve set and matching profile IDs', () => {
  const first = materializeCharacterProfileSet({
    profileSetId: 'profiles-script-episode-1',
    script,
    profiles: validDraft.profiles,
    timestamp: '2026-08-21T02:00:00.000Z'
  });
  const revisedProfiles = structuredClone(validDraft.profiles);
  revisedProfiles[0].introduction = '修改后的人物简介。';
  const second = materializeCharacterProfileSet({
    profileSetId: 'profiles-script-episode-1',
    script,
    profiles: revisedProfiles,
    previousProfileSet: first,
    timestamp: '2026-08-21T03:00:00.000Z'
  });

  assert.equal(second.id, first.id);
  assert.equal(second.version, 2);
  assert.equal(second.approval, 'draft');
  assert.deepEqual(
    second.profiles.map((profile) => profile.id),
    first.profiles.map((profile) => profile.id)
  );
});

test('character evidence IDs are resolved to exact text and ordered scene keys in one request', async () => {
  let calls=0;
  const canonical=value=>value.normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu,'');
  const provider={generate:async request=>{
    calls++;
    const itemSchema=request.outputSchema.properties.profiles.items;
    assert.equal(itemSchema.properties.sourceSceneKeys,undefined);
    assert.deepEqual(itemSchema.properties.sourceFacts.items.required,['fact','evidenceId']);
    assert.match(request.instructions,/程序按编号回填原文/);
    return {output:{profiles:validDraft.profiles.map(profile=>{
      const {sourceSceneKeys,...rest}=structuredClone(profile);
      return {...rest,sourceFacts:profile.sourceFacts.map(fact=>{
        const entry=request.input.evidenceCatalog.find(e=>e.sceneKey===fact.sceneKey&&canonical(e.text).includes(canonical(fact.evidence)));
        assert.ok(entry,`catalog entry for ${fact.sceneKey}`);
        return {fact:fact.fact,evidenceId:entry.evidenceId};
      }).reverse()};
    })}};
  }};
  const result=await generateCharacterProfiles(provider,input);
  assert.equal(calls,1);
  assert.deepEqual(validateCharacterProfileDraft(result.output,input),[]);
  assert.deepEqual(result.output.profiles[0].sourceSceneKeys,['S01','S02']);
  assert.equal(result.output.profiles[0].sourceFacts[0].evidence,script.scenes[1].action);
  assert.equal(result.output.profiles[0].introduction,validDraft.profiles[0].introduction);
});

test('unknown evidence IDs preserve the draft and cannot be replaced by invented quotes', async()=>{
  const raw=structuredClone(validDraft);
  raw.profiles[0].sourceFacts=[{fact:'需要核对的设定',evidenceId:'E-MISSING',sceneKey:'S01',evidence:'伪造的原文'}];
  delete raw.profiles[0].sourceSceneKeys;
  const before=JSON.stringify(raw);
  const result=await generateCharacterProfiles({generate:async()=>({output:raw})},input);
  assert.equal(result.output.profiles[0].sourceFacts[0].evidence,'');
  assert.equal(result.output.profiles[0].sourceFacts[0].unresolvedEvidenceId,'E-MISSING');
  assert.deepEqual(validateCharacterProfileDraft(result.output,input),['profile 1 references unknown evidence ID E-MISSING']);
  assert.equal(JSON.stringify(raw),before);
});
