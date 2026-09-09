import assert from 'node:assert/strict';
import test from 'node:test';
import { reviseCharacterDesign } from '../src/characters/character-design-revision.ts';

test('character design revision updates profile and prompt together without calling image generation', async () => {
  let capturedRequest;
  const provider = {
    async generate(request) {
      capturedRequest = request;
      return {
        output: {
          profile: {
            introduction: '张浩然，六十岁的张家前少主，气度沉稳。',
            identity: '六十岁的张家前少主',
            storyRole: '本集冲突中心',
            personality: ['沉稳', '自信'],
            motivation: '恢复实力并维护尊严',
            physicalKnownFacts: ['六十岁男性', '成熟深刻的面部轮廓', '灰白长发', '挺拔但有岁月感的体态'],
            wardrobeKnownFacts: ['深色古装长袍'],
            designOpenQuestions: [],
          },
          promptSections: {
            basicSetting: '六十岁的张浩然，保持张家前少主身份与深色古装。',
            atmosphereQualityPhotography: '古装玄幻写实三维质感，克制电影光线。',
            contentLayout: '双栏人物主资产图，面部近景清晰呈现皱纹、灰白发丝与成熟骨相，主全身保持挺拔体态。',
            cameraImaging: '近景使用中长焦，全身视图使用标准焦段，统一视平线。',
            negativeTerms: ['青年面孔', '黑发少年感', '皮肤过度光滑', '年龄漂移', '身份不一致'],
          },
        },
      };
    },
  };
  const profile = {
    profileKey: 'C01', name: '张浩然', aliases: ['浩然少主'], introduction: '张家前少主。', identity: '张家前少主', storyRole: '本集冲突中心',
    personality: ['自信'], motivation: '恢复实力', relationships: [{ targetName: '张皓月', relationship: '族妹' }],
    physicalKnownFacts: [], wardrobeKnownFacts: ['深色古装长袍'], designOpenQuestions: ['年龄待确认'],
    sourceSceneKeys: ['S01'], sourceFacts: [{ fact: '张家少主', sceneKey: 'S01', evidence: '浩然少主' }],
  };
  const result = await reviseCharacterDesign(provider, {
    profile,
    currentPrompt: '基础设定\n年轻的张浩然\n\n氛围、画质与摄影风格\n古装玄幻\n\n画面内容与布局\n双栏人物图\n\n摄影机与成像\n标准镜头\n\n负面词\n身份漂移',
    revisionRequest: '把张浩然改为六十岁形象。',
    styleName: '影视级写实CG',
  });

  assert.equal(capturedRequest.operation, 'revise-character-profile-and-image-prompt');
  assert.equal(result.profile.profileKey, 'C01');
  assert.deepEqual(result.profile.relationships, profile.relationships);
  assert.deepEqual(result.profile.sourceFacts, profile.sourceFacts);
  assert.match(result.profile.introduction, /六十岁/u);
  assert.match(result.prompt, /基础设定[\s\S]*六十岁/u);
  assert.match(result.prompt, /画面内容与布局[\s\S]*皱纹/u);
  assert.match(result.prompt, /负面词[\s\S]*青年面孔/u);
});
