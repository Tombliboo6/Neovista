import assert from 'node:assert/strict';
import test from 'node:test';
import { revisePropDesign } from '../src/props/prop-design-revision.ts';

test('prop design revision updates the saved setting and five-section prompt without changing evidence', async () => {
  let capturedRequest;
  const provider = {
    async generate(request) {
      capturedRequest = request;
      return {
        output: {
          baseStateDescription: '黑红配色的无线耳机，左右耳机均带清晰Logo区域。',
          stateVariants: [],
          visualDesignProposal: {
            objectIdentity: '一对高端黑红配色无线耳机。',
            silhouetteAndProportions: '左右对称的入耳式耳机，主体比例紧凑。',
            materialsAndSurface: '哑光黑色主体配深红金属饰面。',
            constructionAndDetails: '触控区预留清晰Logo区域，缝隙与声孔结构完整。',
            colorAndFinish: '主色为哑光黑，深红色沿结构边缘形成稳定识别线。',
            scaleAndHandling: '真实入耳式耳机尺度，成对独立展示。',
            repeatableAnchors: ['黑红双色', '触控区Logo区域', '左右对称轮廓'],
            designDecisions: ['Logo区域保持同一位置与比例'],
          },
          promptSections: {
            basicSetting: '同一对黑红配色无线耳机，保持左右耳结构一致。',
            atmosphereQualityPhotography: '高端产品摄影，真实材质与克制轮廓光。',
            contentSpecifics: '主视图与四个结构视图均显示黑红双色和触控区Logo区域。',
            cameraImaging: '标准产品摄影视角，主视图使用中长焦透视。',
            negativeTerms: ['颜色漂移', 'Logo区域缺失', '左右结构不一致', '出现人物手部', '道具数量错误'],
          },
        },
      };
    },
  };
  const proposal = {
    promptKey: 'PROP-PROMPT-R02', propAssetKey: 'R02', name: '耳机', aliases: ['无线耳机'], sourceSceneKeys: ['S01'], baseStateSceneKey: 'S01', baseStateDescription: '一对无线耳机。',
    sourceFacts: [{ fact: '桌面上放着耳机', sceneKey: 'S01', evidence: '耳机' }], stateVariants: [],
    visualDesignProposal: {
      objectIdentity: '一对无线耳机。', silhouetteAndProportions: '左右对称入耳式。', materialsAndSurface: '塑料与金属。', constructionAndDetails: '触控区与声孔。', colorAndFinish: '黑色。', scaleAndHandling: '真实耳机尺度。', repeatableAnchors: ['左右对称'], designDecisions: [],
    },
  };
  const result = await revisePropDesign(provider, {
    proposal,
    currentPrompt: '基础设定\n黑色无线耳机\n\n氛围、画质与摄影风格\n产品摄影\n\n画面内容与布局\n道具资产板\n\n摄影机与成像\n标准镜头\n\n负面词\n结构错误',
    revisionRequest: 'R02改成黑红配色并带Logo。',
    styleName: '科技专业',
  });

  assert.equal(capturedRequest.operation, 'revise-prop-design-and-image-prompt');
  assert.match(capturedRequest.instructions, /Logo.*不得因此拒绝或暂停/u);
  assert.equal(result.proposal.propAssetKey, 'R02');
  assert.deepEqual(result.proposal.sourceFacts, proposal.sourceFacts);
  assert.match(result.proposal.visualDesignProposal.colorAndFinish, /黑.*红/u);
  assert.match(result.prompt, /基础设定[\s\S]*黑红/u);
  assert.match(result.prompt, /画面内容与布局[\s\S]*Logo区域/u);
  assert.match(result.prompt, /负面词[\s\S]*颜色漂移/u);
});
