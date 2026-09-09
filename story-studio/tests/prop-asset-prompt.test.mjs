import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptPropVisualProposalModelOutput,
  acceptReturnedPropVisualProposalDraft,
  buildPropAssetPromptRequest,
  buildPropPromptsFromProposalsRequest,
  buildPropVisualProposalRequest,
  compilePropAssetPrompt,
  generatePropAssetPrompts,
  generatePropPromptsFromProposals,
  generatePropVisualProposals,
  PropAssetPromptValidationError,
  validatePropAssetPromptDraft,
  validatePropVisualProposalDraft
} from '../src/props/prop-prompt-generation.ts';
import { materializePropAssetPromptSet } from '../src/props/prop-prompt-versioning.ts';

const scene = {
  id: 'script-1-s02', sceneKey: 'S02', order: 2, heading: '石印碎，人消',
  location: '同一片荒野', timeOfDay: '夜晚', interiorExterior: 'exterior',
  sourceSegmentIds: ['seg-1'], sourceStart: 0, sourceEnd: 20,
  sourceEvidence: ['交出人皇印，我可以给你个痛快的死法！'],
  purpose: '逼印与毁印', durationSec: 45,
  action: '掌心出现一枚巴掌大小的普通石印，石印流转着玄妙光芒。雷光轰击石印，石印炸裂。',
  dialogue: [{ kind: 'dialogue', speakerName: '林无双', text: '交出人皇印！', delivery: '冷声' }],
  soundCues: [], transitionOut: 'fade_to_black'
};
const script = {
  id: 'script-1', version: 2, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', approval: 'approved',
  episodeId: 'episode-1', episodeVersion: 1, documentId: 'doc-1', documentVersion: 1,
  title: '测试', logline: '测试', synopsis: '测试', targetDurationSec: 45, estimatedDurationSec: 45,
  openingHook: '开始', endingHook: '结束', scenes: [scene], adaptationNotes: [], continuityOut: '结束'
};
const styleSelection = {
  id: 'style-1', version: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', approval: 'approved',
  characterProfileSetId: 'profiles-1', characterProfileSetVersion: 1, source: 'style-library',
  name: '3D玄幻', stylePrompt: '高品质东方玄幻三维动画电影风格。', referenceMediaPaths: [], selectedBy: 'user'
};
const requiredProps = [{ canonicalName: '人皇印', aliases: ['人皇印', '普通石印', '石印'], requiredStateKeys: ['activated', 'destroyed'] }];
const input = { script, styleSelection, requiredProps };
const modelDraft = {
  prompts: [{
    promptKey: 'R01', propAssetKey: 'R01', name: '人皇印', aliases: ['人皇印', '普通石印', '石印'],
    sourceSceneKeys: ['S02'], baseStateSceneKey: 'S02', baseStateDescription: '未激活、完整、朴素的普通石印',
    sourceFacts: [
      { fact: '巴掌大小的普通石印', sceneKey: 'S02', evidenceId: 'E-S02-ACTION' },
      { fact: '被称作人皇印', sceneKey: 'S02', evidenceId: 'E-S02-SOURCE-01' }
    ],
    stateVariants: [
      { stateKey: 'activated', sceneKey: 'S02', stateDescription: '表面流转玄妙光芒', evidenceIds: ['E-S02-ACTION'] },
      { stateKey: 'destroyed', sceneKey: 'S02', stateDescription: '被雷光轰击后炸裂', evidenceIds: ['E-S02-ACTION'] }
    ],
    visualDesignProposal: {
      objectIdentity: '外表朴素的古旧石印', silhouetteAndProportions: '方形印体，巴掌大小',
      materialsAndSurface: '灰黑细密石材与磨损表面', constructionAndDetails: '低矮印钮与方形基座',
      colorAndFinish: '低饱和灰黑色', scaleAndHandling: '可单手托举',
      repeatableAnchors: ['右上角小缺口', '腰部浅凹线', '底面三道不对称刻槽'],
      designDecisions: ['使用抽象刻槽而非可读文字']
    },
    sections: {
      basicSetting: '未激活、未受损的巴掌大普通石印。',
      atmosphereQualityPhotography: '克制的中性棚拍光，真实石材。',
      contentSpecifics: '灰黑方形基座与低矮印钮，保留三条身份锚点。',
      cameraImaging: '主视图使用85毫米三分之四产品机位，结构视图接近正交。',
      negativeTerms: ['人物或手', '发光', '雷击', '碎裂', '金色宝玺', '可读文字']
    }
  }]
};

test('prop request merges aliases and delegates evidence by ID', () => {
  const request = buildPropAssetPromptRequest(input);
  assert.match(request.instructions, /同一物品的不同称呼必须合并/);
  assert.match(request.instructions, /不要抄写原文/);
  assert.ok(request.input.evidenceCatalog.some((item) => item.evidenceId === 'E-S02-ACTION'));
});

test('staged prop requests keep bookkeeping and evidence ownership in the program', async () => {
  const proposalRequest = buildPropVisualProposalRequest({ script, styleSelection });
  const proposalSchema = proposalRequest.outputSchema.properties.proposals;
  const proposalProperties = proposalSchema.items.properties;
  assert.equal('promptKey' in proposalProperties, false);
  assert.equal('propAssetKey' in proposalProperties, false);
  assert.equal('sourceSceneKeys' in proposalProperties, false);
  assert.equal('baseStateSceneKey' in proposalProperties, false);
  assert.equal('sceneKey' in proposalProperties.sourceFacts.items.properties, false);
  assert.deepEqual(proposalProperties.assetRecommendation.enum, ['required', 'optional', 'text_only']);
  assert.ok(proposalSchema.items.required.includes('assetRecommendation'));
  assert.ok(proposalSchema.items.required.includes('assetRecommendationReason'));
  assert.match(proposalRequest.instructions, /普通食材、常见容器、临时陈设/u);
  assert.match(proposalRequest.instructions, /出现次数只是参考，不得机械决定/u);
  assert.deepEqual(proposalProperties.sourceFacts.items.properties.evidenceId.enum, proposalRequest.input.evidenceCatalog.map((item) => item.evidenceId));
  assert.equal('sceneKey' in proposalProperties.stateVariants.items.properties, false);

  const source = modelDraft.prompts[0];
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async () => ({
    providerId: 'fake', model: 'fake-model', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 1,
    output: { proposals: [{
      name: source.name, aliases: source.aliases, baseStateDescription: source.baseStateDescription,
      sourceFacts: source.sourceFacts.map(({ fact, evidenceId }) => ({ fact, evidenceId })),
      stateVariants: source.stateVariants.map(({ stateKey, stateDescription, evidenceIds }) => ({ stateKey, stateDescription, evidenceIds })),
      visualDesignProposal: source.visualDesignProposal
    }] }
  }) };
  const grounded = await generatePropVisualProposals(provider, { script, styleSelection });
  assert.equal(grounded.output.proposals[0].assetRecommendation, 'optional');
  assert.match(grounded.output.proposals[0].assetRecommendationReason, /旧版提案/u);
  const promptRequest = buildPropPromptsFromProposalsRequest({ script, styleSelection, proposals: grounded.output.proposals });
  const promptSchema = promptRequest.outputSchema.properties.prompts;
  assert.equal(promptSchema.minItems, 1);
  assert.equal(promptSchema.maxItems, 1);
  assert.equal('propAssetKey' in promptSchema.items.properties, false);
});

test('provider output is grounded and validated before acceptance', async () => {
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async () => ({
    providerId: 'fake', model: 'fake-model', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 1, output: modelDraft
  }) };
  const result = await generatePropAssetPrompts(provider, input);
  assert.equal(result.output.prompts[0].sourceFacts[0].evidence, scene.action);
  assert.equal(result.output.prompts[0].stateVariants.length, 2);
});

test('optional design notes and short negative-term lists do not reject usable prop drafts', async () => {
  const relaxedDraft = structuredClone(modelDraft);
  delete relaxedDraft.prompts[0].visualDesignProposal.designDecisions;
  relaxedDraft.prompts[0].sections.negativeTerms = ['身份漂移', '文字水印'];
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async () => ({
    providerId: 'fake', model: 'fake-model', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 1, output: relaxedDraft
  }) };

  const result = await generatePropAssetPrompts(provider, input);
  assert.deepEqual(result.output.prompts[0].visualDesignProposal.designDecisions, []);
  assert.deepEqual(validatePropAssetPromptDraft(result.output, input), []);

  const proposalRequest = buildPropVisualProposalRequest({ script, styleSelection });
  assert.equal(proposalRequest.outputSchema.properties.proposals.items.properties.visualDesignProposal.required.includes('designDecisions'), true);
});

test('staged prop flow creates proposals before prompt sections', async () => {
  const operations = [];
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async (request) => {
    operations.push(request.operation);
    const output = request.operation === 'generate-prop-visual-proposals'
      ? { proposals: modelDraft.prompts.map(({ sections: _sections, promptKey: _promptKey, propAssetKey: _propAssetKey, sourceSceneKeys: _sourceSceneKeys, baseStateSceneKey: _baseStateSceneKey, ...proposal }) => ({
        ...proposal,
        sourceFacts: proposal.sourceFacts.map(({ sceneKey: _sceneKey, ...fact }) => fact),
        stateVariants: proposal.stateVariants.map(({ sceneKey: _sceneKey, ...variant }) => variant)
      })) }
      : { prompts: [{ sections: modelDraft.prompts[0].sections }] };
    return { providerId: 'fake', model: 'fake-model', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 1, output };
  } };
  const proposalResult = await generatePropVisualProposals(provider, { script, styleSelection });
  assert.equal('sections' in proposalResult.output.proposals[0], false);
  const promptResult = await generatePropPromptsFromProposals(provider, { script, styleSelection, proposals: proposalResult.output.proposals });
  assert.deepEqual(operations, ['generate-prop-visual-proposals', 'generate-prop-prompts-from-approved-proposals']);
  assert.equal(promptResult.output.prompts[0].sections.basicSetting, modelDraft.prompts[0].sections.basicSetting);
});

test('staged prop flow normalizes identifiers, aliases and scene ownership from evidence', async () => {
  const source = modelDraft.prompts[0];
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async () => ({
    providerId: 'fake', model: 'fake-model', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 1,
    output: { proposals: [{
      name: ` ${source.name} `,
      aliases: ['普通石印', '人皇印', '普通石印'],
      baseStateDescription: source.baseStateDescription,
      sourceFacts: source.sourceFacts.map(({ fact, evidenceId }) => ({ fact, evidenceId: ` ${evidenceId.toLowerCase()} ` })),
      stateVariants: source.stateVariants.map(({ stateKey, stateDescription, evidenceIds }) => ({ stateKey, stateDescription, evidenceIds: evidenceIds.map((id) => id.toLowerCase()) })),
      visualDesignProposal: source.visualDesignProposal
    }] }
  }) };

  const result = await generatePropVisualProposals(provider, { script, styleSelection });
  const proposal = result.output.proposals[0];
  assert.equal(proposal.promptKey, 'R01');
  assert.equal(proposal.propAssetKey, 'R01');
  assert.equal(proposal.name, '人皇印');
  assert.deepEqual(proposal.aliases, ['人皇印', '普通石印']);
  assert.deepEqual(proposal.sourceSceneKeys, ['S02']);
  assert.equal(proposal.baseStateSceneKey, 'S02');
  assert.equal(proposal.sourceFacts[0].sceneKey, 'S02');
  assert.equal(proposal.stateVariants[0].sceneKey, 'S02');
});

test('one prop state may cite traceable evidence from multiple scenes', () => {
  const secondScene = {
    ...scene,
    id: 'script-1-s03',
    sceneKey: 'S03',
    order: 3,
    heading: '石印余痕',
    action: '碎裂石印的残片散落在地，缺口与上一场雷击位置一致。',
    sourceEvidence: ['碎裂后的石印残片仍可辨认。'],
  };
  const crossSceneInput = { script: { ...script, scenes: [scene, secondScene] }, styleSelection };
  const source = modelDraft.prompts[0];
  const rawOutput = { proposals: [{
    name: source.name,
    aliases: source.aliases,
    baseStateDescription: source.baseStateDescription,
    sourceFacts: source.sourceFacts.map(({ fact, evidenceId }) => ({ fact, evidenceId })),
    stateVariants: [{
      stateKey: 'destroyed',
      stateDescription: '雷击后碎裂并留下可辨认残片',
      evidenceIds: ['E-S02-ACTION', 'E-S03-ACTION'],
    }],
    visualDesignProposal: source.visualDesignProposal,
  }] };

  const accepted = acceptPropVisualProposalModelOutput(rawOutput, crossSceneInput);
  const variant = accepted.proposals[0].stateVariants[0];
  assert.equal(variant.sceneKey, 'S02');
  assert.deepEqual(variant.sourceSceneKeys, ['S02', 'S03']);
  assert.equal(variant.sourceEvidence.length, 2);
});

test('returned grounded prop drafts retain scene bindings during local validation', () => {
  const raw = {
    proposals: [{
      name: modelDraft.prompts[0].name,
      aliases: modelDraft.prompts[0].aliases,
      baseStateDescription: modelDraft.prompts[0].baseStateDescription,
      sourceFacts: modelDraft.prompts[0].sourceFacts.map(({ fact, evidenceId }) => ({ fact, evidenceId })),
      stateVariants: [],
      visualDesignProposal: modelDraft.prompts[0].visualDesignProposal,
    }],
  };
  const firstAcceptance = acceptReturnedPropVisualProposalDraft(raw, { script, styleSelection });
  const secondAcceptance = acceptReturnedPropVisualProposalDraft(structuredClone(firstAcceptance), { script, styleSelection });

  assert.deepEqual(secondAcceptance.proposals[0].sourceSceneKeys, ['S02']);
  assert.equal(secondAcceptance.proposals[0].baseStateSceneKey, 'S02');
  assert.equal(secondAcceptance.proposals[0].sourceFacts[0].evidence, scene.action);
});

test('prop scene mapping repairs isolated drift and quarantines only fully unmapped props', () => {
  const source = modelDraft.prompts[0];
  const mixed = acceptReturnedPropVisualProposalDraft({ proposals: [{
    promptKey: 'R01', propAssetKey: 'R01', name: source.name, aliases: source.aliases,
    assetRecommendation: 'required', assetRecommendationReason: '剧情核心道具。',
    sourceSceneKeys: ['S99', 'S02'], baseStateSceneKey: 'S99', baseStateDescription: source.baseStateDescription,
    sourceFacts: [{ fact: '普通石印', sceneKey: 'S02', evidence: scene.action }],
    stateVariants: [], visualDesignProposal: source.visualDesignProposal,
  }] }, { script, styleSelection });
  assert.deepEqual(mixed.proposals[0].sourceSceneKeys, ['S02']);
  assert.equal(mixed.proposals[0].baseStateSceneKey, 'S02');
  assert.equal(mixed.proposals[0].sourceMappingStatus, 'resolved');
  assert.match(mixed.proposals[0].sourceMappingNote, /已忽略1个/u);
  assert.match(validatePropVisualProposalDraft(mixed, { script, styleSelection }).join('\n'), /source mapping adjusted/u);

  const unmapped = acceptReturnedPropVisualProposalDraft({ proposals: [{
    ...mixed.proposals[0], sourceSceneKeys: ['S99'], baseStateSceneKey: 'S99',
    sourceFacts: [{ fact: '无法定位的道具', sceneKey: 'S99', evidence: '不存在的内容' }],
  }] }, { script, styleSelection });
  assert.deepEqual(unmapped.proposals[0].sourceSceneKeys, []);
  assert.equal(unmapped.proposals[0].sourceMappingStatus, 'needs_review');
  assert.equal(unmapped.proposals[0].assetRecommendation, 'text_only');
  assert.doesNotThrow(() => validatePropVisualProposalDraft(unmapped, { script, styleSelection }));
});

test('sparse staged prop design is retained for review', async () => {
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async () => ({
    providerId: 'fake', model: 'fake-model', externalTaskId: 'prop-malformed-1', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 12,
    output: { proposals: [{
      name: '人皇印', aliases: ['人皇印'], baseStateDescription: '完整石印',
      sourceFacts: [{ fact: '普通石印', evidenceId: 'E-S02-ACTION' }], stateVariants: [],
      visualDesignProposal: { objectIdentity: '普通石印' }
    }] }
  }) };

  const result = await generatePropVisualProposals(provider, { script, styleSelection });
  assert.equal(result.output.proposals[0].name, '人皇印');
  assert.equal(result.output.proposals[0].visualDesignProposal.objectIdentity, '普通石印');
});

test('prop compiler owns the five-section asset-board layout', async () => {
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async () => ({
    providerId: 'fake', model: 'fake-model', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 1, output: modelDraft
  }) };
  const grounded = (await generatePropAssetPrompts(provider, input)).output.prompts[0];
  const compiled = compilePropAssetPrompt(grounded, input);
  assert.match(compiled, /左侧约55%为大型三分之四主视图/);
  assert.match(compiled, /正面、侧面、顶面和底部/);
  assert.doesNotMatch(compiled, /玄妙光芒。\n/);
});

test('prop validation retains a prompt when a state variant needs review', async () => {
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async () => ({
    providerId: 'fake', model: 'fake-model', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 1,
    output: { prompts: [{ ...modelDraft.prompts[0], stateVariants: modelDraft.prompts[0].stateVariants.slice(0, 1) }] }
  }) };
  const result = await generatePropAssetPrompts(provider, input);
  assert.equal(result.output.prompts[0].stateVariants.length, 1);
  assert.match(validatePropAssetPromptDraft(result.output, input).join('\n'), /state variants/);
});

test('prop prompt versions preserve stable set and asset IDs', async () => {
  const provider = { id: 'fake', health: async () => ({ status: 'ok' }), generate: async () => ({
    providerId: 'fake', model: 'fake-model', status: 'completed', completedAt: '2026-01-01T00:00:00Z', elapsedMs: 1, output: modelDraft
  }) };
  const prompts = (await generatePropAssetPrompts(provider, input)).output.prompts;
  validatePropAssetPromptDraft({ prompts }, input);
  const v1 = materializePropAssetPromptSet({ promptSetId: 'prop-prompts-1', ...input, prompts, timestamp: '2026-01-01T00:00:00Z' });
  const v2 = materializePropAssetPromptSet({ promptSetId: 'prop-prompts-1', ...input, prompts, previousPromptSet: v1, timestamp: '2026-01-02T00:00:00Z' });
  assert.equal(v2.version, 2);
  assert.equal(v2.prompts[0].id, v1.prompts[0].id);
  assert.equal(v2.approval, 'draft');
});
