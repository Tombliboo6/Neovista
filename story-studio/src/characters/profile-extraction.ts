import type {
  CharacterProfileDraft,
  Script,
  ScriptScene
} from '../domain/contracts.js';
import type {
  AgentGenerationResult,
  AgentProvider,
  AgentRequest
} from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';
import { partitionAgentDraftValidationIssues } from '../validation/agent-draft-validation.ts';
import { buildPropEvidenceCatalog, type PropEvidenceCatalogItem } from '../props/prop-prompt-generation.ts';

export const CHARACTER_PROFILE_SCHEMA_NAME =
  'prism_autodrama_character_profile_draft_v3';

export interface CharacterProfileExtractionPreferences {
  language?: string;
  requirements?: string[];
}

export interface CharacterProfileExtractionInput {
  script: Script;
  requiredCharacterNames: string[];
  knownCharacters?: Array<{ name: string; aliases: string[]; identity: string; physicalKnownFacts: string[]; wardrobeKnownFacts: string[] }>;
  preferences?: CharacterProfileExtractionPreferences;
}

export interface CharacterProfileExtractionDraft {
  profiles: CharacterProfileDraft[];
}

export class CharacterProfileValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Character profiles failed validation: ${issues.join(' | ')}`);
    this.name = 'CharacterProfileValidationError';
    this.issues = issues;
  }
}

export function buildCharacterProfileRequest(
  input: CharacterProfileExtractionInput
): AgentRequest<CharacterProfileExtractionInput & { evidenceCatalog: PropEvidenceCatalogItem[] }> {
  validateCharacterProfileInput(input);

  return {
    operation: 'extract-character-profiles',
    schemaName: CHARACTER_PROFILE_SCHEMA_NAME,
    instructions: [
      '你是短剧人物策划，负责在已审批剧本之后自动生成人物介绍，供用户检查；此时尚未选择全片画风，也不得生成图片提示词。',
      'requiredCharacterNames是剧本阶段提供的候选实体。先依据它们在完整剧本中的真实功能，选择确实需要跨镜头保持身份连续的人物或角色；不得增加候选之外的名称。profileKey按最终人物顺序使用C01、C02的连续格式。',
      'participation 标记实际出镜为 visual、仅声音为 voice。台词提及或场外讨论不等于本人出场；只有被提及且没有表演或声音任务的人物不输出。人物均未参与时 profiles 返回空数组。',
      '人物身份、剧情作用、性格、动机和关系只能根据 script 中已经出现的信息概括，不得引用下一集或未提供原文。',
      '每条 sourceFacts 只填写可读的 fact 和从 input.evidenceCatalog 选择的 evidenceId。程序按编号回填原文、场次及场次顺序；不要自行抄写或改写引用，不要输出 sourceSceneKeys。fact 可概括，但必须确实由所选原文支持。',
      '候选名单不是必须逐项造档案的名单。若人物在当前剧本中没有实际依据，可以不输出该人物；不得把候选名单、字段说明或“未出场”当作出场证据。',
      'knownCharacters 是本剧此前已确认的基础身份和外貌，姓名或别名明确匹配时沿用；仍只输出当前剧本参与表演或声音的人物。本集简介、动机、关系进展与 sourceFacts 仅依据本集 script，不从人物库推演后续剧情。',
      'physicalKnownFacts 与 wardrobeKnownFacts 只能填写本集剧本或 knownCharacters 已确认的事实；年龄、脸型、发型、体型、服装、配饰等未确定内容必须放入 designOpenQuestions，不得伪装成原文设定。',
      'introduction 是展示给用户的人物简介，清楚说明人物是谁、在本集做什么、想得到什么以及与其他人物的冲突，不写画风、镜头、摄影、图片模型参数。',
      '人物介绍完成后只进入用户检查和风格选择阶段；不得替用户选择风格，也不得启动任何图片生成。',
      '遵守 preferences 中的语言和附加要求。输出必须严格符合 JSON Schema，不要输出解释性文字。'
    ].join('\n'),
    input: { ...input, evidenceCatalog: buildPropEvidenceCatalog(input.script) },
    outputSchema: CHARACTER_PROFILE_OUTPUT_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset
  };
}

export async function generateCharacterProfiles(
  provider: AgentProvider,
  input: CharacterProfileExtractionInput
): Promise<AgentGenerationResult<CharacterProfileExtractionDraft>> {
  const result = await provider.generate<CharacterProfileExtractionDraft>(
    buildCharacterProfileRequest(input)
  );
  const normalizedOutput = normalizeCharacterProfileDraft(result.output, input);
  validateCharacterProfileDraft(normalizedOutput, input);
  return { ...result, output: normalizedOutput };
}

function normalizeCharacterProfileDraft(
  draft: CharacterProfileExtractionDraft,
  input: CharacterProfileExtractionInput
): CharacterProfileExtractionDraft {
  if (!Array.isArray(draft?.profiles)) return draft;
  const sceneOrder = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene.order]));
  const catalog = new Map(buildPropEvidenceCatalog(input.script).map(item => [item.evidenceId, item]));
  return {
    ...draft,
    profiles: draft.profiles.map((profile, index) => {
      const sourceFacts = Array.isArray(profile?.sourceFacts) ? profile.sourceFacts.map(fact => {
        const evidenceId = (fact as typeof fact & { evidenceId?: string }).evidenceId;
        if (typeof evidenceId !== 'string') return fact; // Existing saved drafts retain their original citations.
        const selected = catalog.get(evidenceId);
        return { fact: fact.fact, sceneKey: selected?.sceneKey || '', evidence: selected?.text || '', ...(!selected ? { unresolvedEvidenceId: evidenceId } : {}) };
      }) : profile.sourceFacts;
      const evidenceKeys = Array.isArray(sourceFacts)
        ? [...new Set(sourceFacts.map((fact) => fact?.sceneKey).filter((key) => sceneOrder.has(key)))].sort(
          (left, right) => (sceneOrder.get(left) ?? 0) - (sceneOrder.get(right) ?? 0)
        )
        : [];
      return {
        ...profile,
        profileKey: `C${String(index + 1).padStart(2, '0')}`,
        name: profile.name,
        sourceFacts,
        sourceSceneKeys: evidenceKeys.length > 0 ? evidenceKeys : profile.sourceSceneKeys || []
      };
    })
  };
}

export function validateCharacterProfileDraft(
  draft: CharacterProfileExtractionDraft,
  input: CharacterProfileExtractionInput
): string[] {
  const issues: string[] = [];
  const requiredNames = input.requiredCharacterNames.map(normalizeName);
  const sceneByKey = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene]));
  const sceneOrder = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene.order]));

  if (!Array.isArray(draft.profiles)) {
    throw new CharacterProfileValidationError(['profiles must be an array']);
  }

  const actualNames = draft.profiles.map((profile) => normalizeName(profile.name));
  if (new Set(actualNames).size !== actualNames.length || actualNames.some((name) => !requiredNames.includes(name))) {
    issues.push('profiles must contain unique names selected from requiredCharacterNames');
  }
  const actualOrders = actualNames.map((name) => requiredNames.indexOf(name));
  if (actualOrders.some((order, index) => index > 0 && order <= actualOrders[index - 1]!)) {
    issues.push('profiles must follow requiredCharacterNames order');
  }

  draft.profiles.forEach((profile, index) => {
    const position = index + 1;
    const expectedKey = `C${String(position).padStart(2, '0')}`;
    if (profile.profileKey !== expectedKey) {
      issues.push(`profile ${position} must use profileKey ${expectedKey}`);
    }
    if (!hasCompleteProfileFields(profile)) {
      issues.push(`profile ${position} is missing required introduction fields`);
    }
    if (!Array.isArray(profile.sourceFacts) || profile.sourceFacts.length === 0) {
      issues.push(`profile ${position} requires at least one source fact`);
      return;
    }
    const unresolvedFacts = profile.sourceFacts.filter(fact => (fact as typeof fact & { unresolvedEvidenceId?: string }).unresolvedEvidenceId !== undefined);
    for (const fact of unresolvedFacts) issues.push(`profile ${position} references unknown evidence ID ${(fact as typeof fact & { unresolvedEvidenceId: string }).unresolvedEvidenceId || '(empty)'}`);
    if (!Array.isArray(profile.sourceSceneKeys) || profile.sourceSceneKeys.length === 0) {
      if (!unresolvedFacts.length) issues.push(`profile ${position} requires sourceSceneKeys`);
      return;
    }

    const evidenceSceneKeys: string[] = [];
    for (const sourceFact of profile.sourceFacts) {
      const unresolvedId = (sourceFact as typeof sourceFact & { unresolvedEvidenceId?: string }).unresolvedEvidenceId;
      if (unresolvedId !== undefined) continue;
      const scene = sceneByKey.get(sourceFact.sceneKey);
      if (!scene) {
        issues.push(`profile ${position} references unknown scene ${sourceFact.sceneKey}`);
        continue;
      }
      if (!nonEmpty(sourceFact.fact) || !nonEmpty(sourceFact.evidence)) {
        issues.push(`profile ${position} has an incomplete source fact`);
        continue;
      }
      if (!containsGroundedEvidence(sceneText(scene), sourceFact.evidence)) {
        issues.push(`profile ${position} evidence is not verbatim in scene ${sourceFact.sceneKey}`);
      }
      if (!evidenceSceneKeys.includes(sourceFact.sceneKey)) {
        evidenceSceneKeys.push(sourceFact.sceneKey);
      }
    }

    const declaredKeys = profile.sourceSceneKeys;
    if (new Set(declaredKeys).size !== declaredKeys.length) {
      issues.push(`profile ${position} sourceSceneKeys must be unique`);
    }
    if (declaredKeys.some((key) => !sceneByKey.has(key))) {
      issues.push(`profile ${position} sourceSceneKeys contain an unknown scene`);
    }
    if (!isInScriptOrder(declaredKeys, sceneOrder)) {
      issues.push(`profile ${position} sourceSceneKeys must follow script order`);
    }
    const orderedEvidenceKeys = evidenceSceneKeys.sort((left, right) => (sceneOrder.get(left) ?? 0) - (sceneOrder.get(right) ?? 0));
    if (declaredKeys.join('\u0000') !== orderedEvidenceKeys.join('\u0000')) {
      issues.push(`profile ${position} sourceSceneKeys must match its evidence scenes`);
    }
  });

  const report = partitionAgentDraftValidationIssues('character-profile', issues);
  if (report.blockingIssues.length > 0) throw new CharacterProfileValidationError(report.blockingIssues);
  return report.warnings;
}

function containsGroundedEvidence(scene: string, evidence: string): boolean {
  if (scene.includes(evidence)) return true;
  const canonical = (value: string) => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
  const normalizedEvidence = canonical(evidence);
  return normalizedEvidence.length >= 4 && canonical(scene).includes(normalizedEvidence);
}

function validateCharacterProfileInput(input: CharacterProfileExtractionInput): void {
  if (input.script.approval !== 'approved') {
    throw new Error('Script must be approved before character profile extraction.');
  }
  if (!Array.isArray(input.requiredCharacterNames) || input.requiredCharacterNames.length === 0) {
    throw new Error('Character profile extraction requires at least one character name.');
  }
  if (input.requiredCharacterNames.some((name) => !nonEmpty(name))) {
    throw new Error('Required character names must not be empty.');
  }
  const normalized = input.requiredCharacterNames.map(normalizeName);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Required character names must be unique.');
  }

}

function hasCompleteProfileFields(profile: CharacterProfileDraft): boolean {
  if (
    ![
      profile.profileKey,
      profile.name,
      profile.introduction,
      profile.identity,
      profile.storyRole,
      profile.motivation
    ].every(nonEmpty)
  ) {
    return false;
  }
  return (
    Array.isArray(profile.aliases) &&
    Array.isArray(profile.personality) &&
    profile.personality.length > 0 &&
    profile.personality.every(nonEmpty) &&
    Array.isArray(profile.relationships) &&
    profile.relationships.every(
      (relationship) => nonEmpty(relationship.targetName) && nonEmpty(relationship.relationship)
    ) &&
    Array.isArray(profile.physicalKnownFacts) &&
    profile.physicalKnownFacts.every(nonEmpty) &&
    Array.isArray(profile.wardrobeKnownFacts) &&
    profile.wardrobeKnownFacts.every(nonEmpty) &&
    Array.isArray(profile.designOpenQuestions) &&
    profile.designOpenQuestions.every(nonEmpty)
  );
}

function sceneText(scene: ScriptScene): string {
  return [
    scene.heading,
    scene.location,
    scene.timeOfDay,
    scene.purpose,
    scene.action,
    ...scene.sourceEvidence,
    ...scene.dialogue.flatMap((line) => [line.speakerName, line.text, line.delivery]),
    ...scene.soundCues
  ].join('\n');
}

function isInScriptOrder(
  keys: string[],
  sceneOrder: Map<string, number>
): boolean {
  return keys.every(
    (key, index) =>
      index === 0 ||
      (sceneOrder.get(key) ?? Number.POSITIVE_INFINITY) >
        (sceneOrder.get(keys[index - 1]!) ?? Number.NEGATIVE_INFINITY)
  );
}

function normalizeName(value: string): string {
  return value.trim();
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

const CHARACTER_PROFILE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    profiles: {
      type: 'array',
      minItems: 0,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          participation: { type: 'string', enum: ['visual', 'voice'] },
          profileKey: { type: 'string', pattern: '^C[0-9]{2,}$' },
          name: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          introduction: { type: 'string' },
          identity: { type: 'string' },
          storyRole: { type: 'string' },
          personality: { type: 'array', minItems: 1, items: { type: 'string' } },
          motivation: { type: 'string' },
          relationships: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                targetName: { type: 'string' },
                relationship: { type: 'string' }
              },
              required: ['targetName', 'relationship']
            }
          },
          physicalKnownFacts: { type: 'array', items: { type: 'string' } },
          wardrobeKnownFacts: { type: 'array', items: { type: 'string' } },
          designOpenQuestions: { type: 'array', items: { type: 'string' } },
          sourceFacts: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fact: { type: 'string' },
                evidenceId: { type: 'string' }
              },
              required: ['fact', 'evidenceId']
            }
          }
        },
        required: [
          'participation',
          'profileKey',
          'name',
          'aliases',
          'introduction',
          'identity',
          'storyRole',
          'personality',
          'motivation',
          'relationships',
          'physicalKnownFacts',
          'wardrobeKnownFacts',
          'designOpenQuestions',
          'sourceFacts'
        ]
      }
    }
  },
  required: ['profiles']
};
