import { CREATIVE_SELF_REVIEW } from '../providers/creative-review.ts';
import type { AgentGenerationResult, AgentProvider, AgentRequest } from '../providers/contracts.js';
import type { StoryboardSegment } from '../domain/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';
import { partitionAgentDraftValidationIssues } from '../validation/agent-draft-validation.ts';

export type StoryboardBoardPanelCount = 3 | 4 | 6 | 9;
export const DEFAULT_STORYBOARD_BOARD_PANEL_COUNT: StoryboardBoardPanelCount = 3;

export type StoryboardPanelTransition = 'initial' | 'continuous' | 'cut';
export type StoryboardCutTrigger =
  | 'initial'
  | 'none'
  | 'shot-size-change'
  | 'camera-position-change'
  | 'attention-shift'
  | 'new-visible-result'
  | 'time-or-location-change'
  | 'new-action-goal'
  | 'reaction-beat'
  | 'critical-action-control';
export type StoryboardActionPhase = 'setup' | 'progress' | 'complete' | 'hold';

export interface StoryboardBoardPanelPlan {
  panelKey: string;
  order: number;
  startSec: number;
  endSec: number;
  shotGroupKey: string;
  transitionFromPrevious: StoryboardPanelTransition;
  cutTrigger: StoryboardCutTrigger;
  startState: string;
  actionUnitKey: string;
  actionOwner: string;
  actionSummary: string;
  actionPhase: StoryboardActionPhase;
  endState: string;
  shotSize: string;
  camera: string;
  visual: string;
  characters: string[];
  visibleProps: string[];
}

export interface StoryboardBoardPlan {
  panelCount: StoryboardBoardPanelCount;
  semanticDecision: {
    visibleCharacters: string[];
    characterStates: Array<{ characterName: string; state: string }>;
    visibleProps: Array<{ propName: string; state: string }>;
    sceneState: string;
    excludedElements: string[];
    decisionBasis: string[];
  };
  referenceRequirements?: {
    characters: string[];
    sceneRequired: boolean;
    props: Array<{ propName: string; state: string }>;
    decisionBasis: string[];
  };
  panels: StoryboardBoardPanelPlan[];
  imagePromptSections: {
    basicSetting: string;
    atmosphereQualityPhotography: string;
    contentLayout: string;
    cameraImaging: string;
    negativeTerms: string[];
  };
}

export interface StoryboardBoardPlanInput {
  segment: StoryboardSegment;
  panelCount?: StoryboardBoardPanelCount;
  styleName: string;
  characterAnchor: string;
  sceneAnchor: string;
  referenceDescription?: string;
  availableAssetContext?: unknown[];
  allowedReferenceContext?: {
    characters: string[];
    sceneRequired: boolean;
    props: Array<{ propName: string; state: string }>;
  };
  continuityContext?: unknown;
  imageSafetyGuidance?: string;
}

export function buildStoryboardBoardPlanRequest(input: StoryboardBoardPlanInput): AgentRequest {
  const panelCount = input.panelCount ?? DEFAULT_STORYBOARD_BOARD_PANEL_COUNT;
  validatePanelCount(panelCount);
  return {
    operation: 'plan-storyboard-board-panels',
    schemaName: 'prism_autodrama_storyboard_board_plan_v3',
    maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft,
    instructions: [
      CREATIVE_SELF_REVIEW,
      `把一个${input.segment.durationSec}秒文字分镜规划为${panelCount}个按时间顺序排列的静态故事板画面。`,
      `必须按叙事顺序输出${panelCount}格；程序会统一生成P01至P${String(panelCount).padStart(2, '0')}和画格顺序；你负责真实可见的镜头内容、时间区间与切镜安排。`,
      '每格只描述该时刻可见的画面、人物动作、表情、空间关系、景别和机位，不写长篇导演解释。',
      `${panelCount}宫格是按时间排列的叙事检查点，不等于${panelCount}个镜头；不要为了填满画格机械切镜。由你根据镜头执行需要设置连续镜头组与切镜。`,
      '每格写清动作前状态、行动主体、行动摘要、动作后可见结果。开始与结束状态由你按实际画面填写，相邻状态不要求逐字相同。',
      '行动主体必须是实际施力、说话、移动或引发环境变化的现有人物、物体或环境主体，静态画面可直接描述物体或环境状态。外力动作要写清施力主体、接触变化、惯性过程和最终落点。',
      '先根据剧本证据、人物资料、场景资料、道具资料和相邻分镜，自主判断本段实际可见人物、人物状态、可见道具、场景状态与应排除元素，再据此规划画格。不要把人物资产中出现的代表性道具自动当作当前剧情道具。',
      '保持动作因果与人物身份连续；不得新增对白、旁白、下一场内容或剧本外事件。',
      '对白只用于决定人物当时的口型与表演，不要让故事板图片渲染字幕、对白框或文字。',
      'semanticDecision、每格characters/visibleProps与画面描述必须彼此一致。只输出简洁判断结果，不输出思维过程或资产ID。',
      '另行输出referenceRequirements，专门决定需要上传哪些人物、场景和道具参考图。画面可见物不等于都需要独立参考：雨水、泥浆、血液、烟尘、碎屑等临时物质可以出现在visibleProps中，但通常不应要求参考资产；已批准的持续人物、场景和关键剧情道具才按需要列入参考。不得输出资产ID、版本、路径或文件名。',
      input.allowedReferenceContext
        ? 'input.allowedReferenceContext只是当前确有批准图片的候选范围，不代表全部必须使用。你负责判断本分镜实际需要哪些参考；凡已在semanticDecision或画格中判定为可见、且候选范围中已有图片的持续人物或关键剧情道具，必须列入referenceRequirements。不得引用候选范围之外的资产。'
        : 'referenceRequirements只能引用当前分镜实际可见且已有批准资产的内容。',
      `imagePromptSections只需提供本段稳定基础设定、整体氛围画质摄影风格和5至8个最高风险负面词。程序会从panels生成${panelCount}格版式、逐格布局、时间、景别和机位，避免模型重复抄写。`
      ,
      input.imageSafetyGuidance
        ? `本段图片安全改编要求：${input.imageSafetyGuidance}。只调整静态画面的呈现强度，不改人物、对白、动作因果或剧情结果；最终imagePromptSections必须完全遵守。`
        : '按原剧本强度规划静态画面，不额外增加刺激性细节。'
    ].join('\n'),
    input: {
      segment: {
        segmentKey: input.segment.segmentKey,
        sceneKeys: input.segment.sceneKeys ?? [input.segment.sceneKey],
        durationSec: input.segment.durationSec,
        characters: input.segment.characters,
        propStateKey: input.segment.propStateKey,
        storyboardText: input.segment.storyboardText,
        groundedEvidence: input.segment.groundedEvidence
      },
      panelCount,
      styleName: input.styleName,
      characterAnchor: input.characterAnchor,
      sceneAnchor: input.sceneAnchor,
      availableAssetContext: input.availableAssetContext ?? [],
      allowedReferenceContext: input.allowedReferenceContext ?? null,
      continuityContext: input.continuityContext ?? {}
      ,
      imageSafetyGuidance: input.imageSafetyGuidance ?? ''
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        semanticDecision: {
          type: 'object', additionalProperties: false,
          properties: {
            visibleCharacters: { type: 'array', items: { type: 'string' }, uniqueItems: true },
            characterStates: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { characterName: { type: 'string' }, state: { type: 'string' } }, required: ['characterName', 'state'] } },
            visibleProps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { propName: { type: 'string' }, state: { type: 'string' } }, required: ['propName', 'state'] } },
            sceneState: { type: 'string' },
            excludedElements: { type: 'array', items: { type: 'string' }, uniqueItems: true },
            decisionBasis: { type: 'array', minItems: 1, items: { type: 'string' } }
          },
          required: ['visibleCharacters', 'characterStates', 'visibleProps', 'sceneState', 'excludedElements', 'decisionBasis']
        },
        panels: {
          type: 'array',
          minItems: panelCount,
          maxItems: panelCount,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              startSec: { type: 'number', minimum: 0, maximum: input.segment.durationSec },
              endSec: { type: 'number', minimum: 0, maximum: input.segment.durationSec },
              shotGroupKey: { type: 'string' },
              transitionFromPrevious: { type: 'string', enum: ['initial', 'continuous', 'cut'] },
              cutTrigger: { type: 'string', enum: ['initial', 'none', 'shot-size-change', 'camera-position-change', 'attention-shift', 'new-visible-result', 'time-or-location-change', 'new-action-goal', 'reaction-beat', 'critical-action-control'] },
              startState: { type: 'string' },
              actionOwner: { type: 'string' },
              actionSummary: { type: 'string' },
              endState: { type: 'string' },
              shotSize: { type: 'string' },
              camera: { type: 'string' },
              visual: { type: 'string' },
              characters: { type: 'array', items: { type: 'string' }, uniqueItems: true },
              visibleProps: { type: 'array', items: { type: 'string' }, uniqueItems: true }
            },
            required: ['startSec', 'endSec', 'shotGroupKey', 'transitionFromPrevious', 'cutTrigger', 'startState', 'actionOwner', 'actionSummary', 'endState', 'shotSize', 'camera', 'visual', 'characters', 'visibleProps']
          }
        },
        imagePromptSections: {
          type: 'object', additionalProperties: false,
          properties: {
            basicSetting: { type: 'string' },
            atmosphereQualityPhotography: { type: 'string' },
            negativeTerms: { type: 'array', items: { type: 'string' }, uniqueItems: true }
          },
          required: ['basicSetting', 'atmosphereQualityPhotography', 'negativeTerms']
        }
        ,
        referenceRequirements: {
          type: 'object', additionalProperties: false,
          properties: {
            characters: { type: 'array', items: { type: 'string' }, uniqueItems: true },
            sceneRequired: { type: 'boolean' },
            props: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { propName: { type: 'string' }, state: { type: 'string' } }, required: ['propName', 'state'] } },
            decisionBasis: { type: 'array', minItems: 1, items: { type: 'string' } }
          },
          required: ['characters', 'sceneRequired', 'props', 'decisionBasis']
        }
      },
      required: ['semanticDecision', 'referenceRequirements', 'panels', 'imagePromptSections']
    }
  };
}

export async function generateStoryboardBoardPlan(
  provider: AgentProvider,
  input: StoryboardBoardPlanInput
): Promise<AgentGenerationResult<StoryboardBoardPlan>> {
  const result = await provider.generate<StoryboardBoardPlan>(buildStoryboardBoardPlanRequest(input));
  const output = normalizeStoryboardBoardPlan(result.output, input);
  validateStoryboardBoardPlan(
    output,
    input.segment.durationSec,
    input.panelCount ?? DEFAULT_STORYBOARD_BOARD_PANEL_COUNT,
    input.allowedReferenceContext
  );
  return { ...result, output };
}

export function normalizeStoryboardBoardPlan(
  plan: StoryboardBoardPlan,
  input: StoryboardBoardPlanInput
): StoryboardBoardPlan {
  const expectedPanelCount = input.panelCount ?? DEFAULT_STORYBOARD_BOARD_PANEL_COUNT;
  const candidate = isRecord(plan) ? plan as unknown as Record<string, unknown> : {};
  const sourcePanels = Array.isArray(candidate.panels) ? candidate.panels : [];
  const referencesNormalized = normalizeStoryboardBoardPlanReferences(plan, input);
  if (sourcePanels.length !== expectedPanelCount || sourcePanels.some((panel) => !isRecord(panel))) {
    return referencesNormalized;
  }
  const hasVisibleContent = sourcePanels.every((panel) => {
    if (!isRecord(panel)) return false;
    return nonEmptyString(panel.visual) || nonEmptyString(panel.actionSummary);
  });
  if (!hasVisibleContent) return referencesNormalized;

  const normalizedPanels: StoryboardBoardPanelPlan[] = [];
  let shotGroupNumber = 1;
  let previousRawShotGroupKey = '';
  let previousEndState = '';
  for (let index = 0; index < sourcePanels.length; index += 1) {
    const source = sourcePanels[index] as Record<string, unknown>;
    const characters = uniqueUnknownStrings(source.characters);
    const visibleProps = uniqueUnknownStrings(source.visibleProps);
    const actionOwner = stringOr(source.actionOwner, characters[0] ?? '环境');
    const actionSummary = stringOr(source.actionSummary, stringOr(source.visual, '状态推进'));
    const visual = stringOr(source.visual, actionSummary);
    const shotSize = stringOr(source.shotSize, '中景');
    const camera = stringOr(source.camera, '平视固定机位');
    const rawShotGroupKey = stringOr(source.shotGroupKey, '');
    const requestedCut = index > 0 && (
      source.transitionFromPrevious === 'cut'
      || isConcreteCutTrigger(source.cutTrigger)
      || Boolean(rawShotGroupKey && previousRawShotGroupKey && rawShotGroupKey !== previousRawShotGroupKey)
    );
    const isCut = requestedCut;
    if (isCut) shotGroupNumber += 1;
    const startSec = typeof source.startSec === 'number' ? source.startSec : normalizedBoundary(input.segment.durationSec, index, expectedPanelCount);
    const endSec = typeof source.endSec === 'number' ? source.endSec : normalizedBoundary(input.segment.durationSec, index + 1, expectedPanelCount);
    const startState = stringOr(source.startState, index === 0 ? `开始状态：${visual}` : previousEndState);
    const endState = stringOr(source.endState, `结束状态：${visual}`);
    normalizedPanels.push({
      panelKey: `P${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      startSec,
      endSec,
      shotGroupKey: `SH${String(shotGroupNumber).padStart(2, '0')}`,
      transitionFromPrevious: index === 0 ? 'initial' : isCut ? 'cut' : 'continuous',
      cutTrigger: index === 0 ? 'initial' : isCut ? normalizeCutTrigger(source.cutTrigger, sourcePanels[index - 1], source) : 'none',
      startState,
      actionUnitKey: '',
      actionOwner,
      actionSummary,
      actionPhase: 'complete',
      endState,
      shotSize,
      camera,
      visual,
      characters,
      visibleProps
    });
    previousRawShotGroupKey = rawShotGroupKey || previousRawShotGroupKey;
    previousEndState = endState;
  }
  normalizeActionUnits(normalizedPanels);

  const sourceSemantic = isRecord(candidate.semanticDecision) ? candidate.semanticDecision : {};
  const visibleCharacters = uniqueStrings([
    ...uniqueUnknownStrings(sourceSemantic.visibleCharacters),
    ...normalizedPanels.flatMap((panel) => panel.characters)
  ]);
  const visiblePropNames = uniqueStrings([
    ...readNamedStates(sourceSemantic.visibleProps, 'propName').map((item) => item.name),
    ...normalizedPanels.flatMap((panel) => panel.visibleProps)
  ]);
  const sourceCharacterStates = readNamedStates(sourceSemantic.characterStates, 'characterName');
  const sourceVisibleProps = readNamedStates(sourceSemantic.visibleProps, 'propName');
  const sourcePromptSections = isRecord(candidate.imagePromptSections) ? candidate.imagePromptSections : {};
  const layout = boardLayout(expectedPanelCount);
  const contentLayout = normalizedPanels.map((panel) => {
    const characters = panel.characters.length ? panel.characters.join('、') : '无人入镜';
    const props = panel.visibleProps.length ? panel.visibleProps.join('、') : '无独立剧情道具';
    return `${panel.panelKey}（${formatTime(panel.startSec)}-${formatTime(panel.endSec)}秒）：${panel.shotSize}，${panel.camera}；人物：${characters}；道具：${props}；${panel.visual}`;
  }).join('\n');
  const cameraImaging = normalizedPanels
    .map((panel) => `${panel.panelKey}：${panel.shotSize}，${panel.camera}`)
    .join('；');
  const negativeTerms = ensureNegativeTerms(sourcePromptSections.negativeTerms);

  return {
    ...referencesNormalized,
    panelCount: expectedPanelCount,
    semanticDecision: {
      visibleCharacters,
      characterStates: visibleCharacters.map((characterName) => ({
        characterName,
        state: sourceCharacterStates.find((item) => item.name === characterName)?.state ?? `按${expectedPanelCount}宫格画面保持身份、服装与动作连续`
      })),
      visibleProps: visiblePropNames.map((propName) => ({
        propName,
        state: sourceVisibleProps.find((item) => item.name === propName)?.state ?? '按对应画格保持可见状态'
      })),
      sceneState: stringOr(sourceSemantic.sceneState, input.sceneAnchor),
      excludedElements: uniqueUnknownStrings(sourceSemantic.excludedElements),
      decisionBasis: uniqueUnknownStrings(sourceSemantic.decisionBasis).length
        ? uniqueUnknownStrings(sourceSemantic.decisionBasis)
        : ['程序依据当前文字分镜和每格可见内容汇总']
    },
    panels: normalizedPanels,
    imagePromptSections: {
      basicSetting: `${layout.description}，从左到右、从上到下阅读，均匀窄分隔线，无文字标签。${stringOr(sourcePromptSections.basicSetting, '')}`.trim(),
      atmosphereQualityPhotography: stringOr(sourcePromptSections.atmosphereQualityPhotography, `${input.styleName}，人物、场景与材质在全部画格中保持一致`),
      contentLayout,
      cameraImaging: cameraImaging || stringOr(sourcePromptSections.cameraImaging, '各画格分别执行对应景别与机位'),
      negativeTerms
    }
  };
}

export function normalizeStoryboardBoardPlanReferences(
  plan: StoryboardBoardPlan,
  input: StoryboardBoardPlanInput
): StoryboardBoardPlan {
  const allowed = input.allowedReferenceContext;
  if (!allowed) return plan;
  const requested = plan.referenceRequirements;
  const visibleCharacters = uniqueStrings([
    ...(requested?.characters ?? []),
    ...(plan.semanticDecision?.visibleCharacters ?? [])
  ]);
  const allowedCharacters = new Set(uniqueStrings(allowed.characters));
  const visiblePropNames = uniqueStrings([
    ...(requested?.props ?? []).map((prop) => prop.propName),
    ...(plan.semanticDecision?.visibleProps ?? []).map((prop) => prop.propName),
    ...(plan.panels ?? []).flatMap((panel) => panel.visibleProps ?? [])
  ]);
  const allowedPropsByName = new Map(uniqueReferenceProps(allowed.props).map((prop) => [prop.propName, prop]));
  return {
    ...plan,
    referenceRequirements: {
      characters: visibleCharacters.filter((name) => allowedCharacters.has(name)),
      sceneRequired: Boolean(requested?.sceneRequired && allowed.sceneRequired),
      props: visiblePropNames.map((name) => allowedPropsByName.get(name)).filter((prop): prop is { propName: string; state: string } => Boolean(prop)),
      decisionBasis: uniqueStrings(requested?.decisionBasis ?? ['总导演依据本分镜可见内容选择已批准参考图'])
    }
  };
}

export function validateStoryboardBoardPlan(
  plan: StoryboardBoardPlan,
  durationSec: number,
  expectedPanelCount: StoryboardBoardPanelCount,
  allowedReferenceContext?: StoryboardBoardPlanInput['allowedReferenceContext']
): string[] {
  const issues: string[] = [];
  const candidate = isRecord(plan) ? plan as unknown as Record<string, unknown> : {};
  const panels = Array.isArray(candidate.panels) ? candidate.panels : [];
  if (!isRecord(plan)) issues.push('plan must be an object');
  if (!Array.isArray(candidate.panels)) issues.push('plan.panels must be an array');
  if (candidate.panelCount !== expectedPanelCount || panels.length !== expectedPanelCount) issues.push(`expected ${expectedPanelCount} panels`);
  let cursor = 0;
  panels.forEach((value, index) => {
    const expectedKey = `P${String(index + 1).padStart(2, '0')}`;
    if (!isRecord(value)) { issues.push(`${expectedKey} must be an object`); return; }
    if (value.panelKey !== expectedKey || value.order !== index + 1) issues.push(`${expectedKey} identity/order mismatch`);
    const startSec = typeof value.startSec === 'number' ? value.startSec : Number.NaN;
    const endSec = typeof value.endSec === 'number' ? value.endSec : Number.NaN;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec !== cursor || endSec <= startSec) issues.push(`${expectedKey} time range is not continuous`);
    if (Number.isFinite(endSec)) cursor = endSec;
    if (![value.shotSize, value.camera, value.visual].every((item) => typeof item === 'string' && item.trim()) || !Array.isArray(value.characters) || !Array.isArray(value.visibleProps)) issues.push(`${expectedKey} requires visible shot content`);
  });
  if (cursor !== durationSec) issues.push(`panel timeline must end at ${durationSec}`);
  const semanticDecision = isRecord(candidate.semanticDecision) ? candidate.semanticDecision : null;
  const visibleCharacters = semanticDecision && Array.isArray(semanticDecision.visibleCharacters) ? semanticDecision.visibleCharacters : [];
  const visibleProps = semanticDecision && Array.isArray(semanticDecision.visibleProps) ? semanticDecision.visibleProps : [];
  const imagePromptSections = isRecord(candidate.imagePromptSections) ? candidate.imagePromptSections : null;
  if (!semanticDecision || !Array.isArray(semanticDecision.visibleCharacters) || !Array.isArray(semanticDecision.visibleProps)) issues.push('plan.semanticDecision is invalid');
  if (!imagePromptSections) issues.push('plan.imagePromptSections is invalid');
  const referenceRequirements = isRecord(candidate.referenceRequirements) ? candidate.referenceRequirements : null;
  const referenceCharacters = referenceRequirements && Array.isArray(referenceRequirements.characters) ? referenceRequirements.characters : [];
  const referenceProps = referenceRequirements && Array.isArray(referenceRequirements.props) ? referenceRequirements.props : [];
  if (!referenceRequirements || !Array.isArray(referenceRequirements.characters) || !Array.isArray(referenceRequirements.props) || typeof referenceRequirements.sceneRequired !== 'boolean') issues.push('plan.referenceRequirements is invalid');
  for (const name of referenceCharacters) {
    const approvedMediatedReference = typeof name === 'string' && allowedReferenceContext?.characters.includes(name);
    if (allowedReferenceContext && typeof name === 'string' && !approvedMediatedReference) issues.push(`reference character ${name} has no approved image`);
    if (typeof name === 'string' && !visibleCharacters.includes(name) && !approvedMediatedReference) issues.push(`reference character ${name} is not visible`);
  }
  if (referenceRequirements?.sceneRequired === true && allowedReferenceContext && !allowedReferenceContext.sceneRequired) issues.push('reference scene has no approved image');
  for (const prop of referenceProps) {
    const propName = isRecord(prop) && typeof prop.propName === 'string' ? prop.propName : '';
    const approvedMediatedReference = Boolean(propName) && allowedReferenceContext?.props.some((prop) => prop.propName === propName);
    if (allowedReferenceContext && propName && !approvedMediatedReference) issues.push(`reference prop ${propName} has no approved image`);
    if (!propName || !visibleProps.some((visible) => isRecord(visible) && visible.propName === propName) && !approvedMediatedReference) issues.push('reference prop is not visible');
  }
  const contentLayout = imagePromptSections && typeof imagePromptSections.contentLayout === 'string' ? imagePromptSections.contentLayout : '';
  const basicSetting = imagePromptSections && typeof imagePromptSections.basicSetting === 'string' ? imagePromptSections.basicSetting : '';
  const boardDefinition = `${basicSetting}\n${contentLayout}`;
  const layout = boardLayout(expectedPanelCount);
  if (!boardDefinition.includes(layout.marker)) issues.push(`prompt sections must state the ${layout.marker} board`);
  for (let index = 1; index <= expectedPanelCount; index += 1) {
    const panelKey = `P${String(index).padStart(2, '0')}`;
    if (!contentLayout.includes(panelKey)) issues.push(`content layout must include ${panelKey}`);
  }
  const report = partitionAgentDraftValidationIssues('storyboard-board', issues);
  if (report.blockingIssues.length) throw new Error(`Storyboard board plan validation failed: ${report.blockingIssues.join('; ')}`);
  return report.warnings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isConcreteCutTrigger(value: unknown): value is StoryboardCutTrigger {
  return [
    'shot-size-change',
    'camera-position-change',
    'attention-shift',
    'new-visible-result',
    'time-or-location-change',
    'new-action-goal',
    'reaction-beat',
    'critical-action-control'
  ].includes(String(value));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function uniqueUnknownStrings(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === 'string')) : [];
}

function stringOr(value: unknown, fallback: string): string {
  return nonEmptyString(value) ? value.trim() : fallback;
}

function normalizedBoundary(durationSec: number, index: number, panelCount: number): number {
  if (index <= 0) return 0;
  if (index >= panelCount) return durationSec;
  return Number(((durationSec * index) / panelCount).toFixed(3));
}

function normalizeCutTrigger(value: unknown, previous: unknown, current: Record<string, unknown>): StoryboardCutTrigger {
  if (isConcreteCutTrigger(value)) return value;
  if (isRecord(previous) && stringOr(previous.shotSize, '') !== stringOr(current.shotSize, '')) return 'shot-size-change';
  if (isRecord(previous) && stringOr(previous.camera, '') !== stringOr(current.camera, '')) return 'camera-position-change';
  return 'new-visible-result';
}

function normalizeActionUnits(panels: StoryboardBoardPanelPlan[]): void {
  let actionUnitNumber = 0;
  let groupStart = 0;
  while (groupStart < panels.length) {
    const signature = `${panels[groupStart].actionOwner}\u0000${panels[groupStart].actionSummary}`;
    let groupEnd = groupStart + 1;
    while (groupEnd < panels.length) {
      const nextSignature = `${panels[groupEnd].actionOwner}\u0000${panels[groupEnd].actionSummary}`;
      if (nextSignature !== signature) break;
      groupEnd += 1;
    }
    actionUnitNumber += 1;
    const key = `AU${String(actionUnitNumber).padStart(2, '0')}`;
    const owner = panels[groupStart].actionOwner;
    const summary = panels[groupStart].actionSummary;
    for (let index = groupStart; index < groupEnd; index += 1) {
      panels[index].actionUnitKey = key;
      panels[index].actionOwner = owner;
      panels[index].actionSummary = summary;
      const length = groupEnd - groupStart;
      panels[index].actionPhase = length === 1
        ? 'complete'
        : index === groupStart
          ? 'setup'
          : index === groupEnd - 1
            ? 'complete'
            : 'progress';
    }
    groupStart = groupEnd;
  }
}

function readNamedStates(value: unknown, nameKey: 'characterName' | 'propName'): Array<{ name: string; state: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = stringOr(item[nameKey], '');
    const state = stringOr(item.state, '');
    return name && state ? [{ name, state }] : [];
  });
}

function ensureNegativeTerms(value: unknown): string[] {
  const defaults = ['画格数量错误', '画格顺序错误', '人物身份漂移', '场景结构漂移', '文字与水印', '多余人物', '道具状态错误', '画格融合'];
  const terms = uniqueStrings([
    ...uniqueUnknownStrings(value),
    ...defaults
  ]);
  return terms.slice(0, 8);
}

function boardLayout(panelCount: StoryboardBoardPanelCount): { marker: string; description: string } {
  if (panelCount === 3) return { marker: '3列×1行', description: '故事板画布，3列×1行共3个独立画格' };
  if (panelCount === 4) return { marker: '2列×2行', description: '故事板画布，2列×2行共4个独立画格' };
  if (panelCount === 9) return { marker: '3列×3行', description: '故事板画布，3列×3行共9个独立画格' };
  return { marker: '3列×2行', description: '故事板画布，3列×2行共6个独立画格' };
}

function formatTime(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function uniqueReferenceProps(values: Array<{ propName: string; state: string }>): Array<{ propName: string; state: string }> {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const propName = typeof value?.propName === 'string' ? value.propName.trim() : '';
    const state = typeof value?.state === 'string' ? value.state.trim() : '';
    const key = `${propName}\u0000${state}`;
    if (!propName || !state || seen.has(key)) return [];
    seen.add(key);
    return [{ propName, state }];
  });
}

export function compileStoryboardBoardImagePrompt(input: StoryboardBoardPlanInput, plan: StoryboardBoardPlan): string {
  validateStoryboardBoardPlan(plan, input.segment.durationSec, plan.panelCount, input.allowedReferenceContext);
  return [
    `参考图：${input.referenceDescription ?? '使用本任务列出的已批准人物、场景与道具资产，仅锁定对应身份、空间和物品状态'}`,
    `分镜来源：${input.segment.segmentKey}「${input.segment.title}」，时长${input.segment.durationSec}秒`,
    '',
    '基础设定',
    plan.imagePromptSections.basicSetting,
    '',
    '氛围、画质与摄影风格',
    plan.imagePromptSections.atmosphereQualityPhotography,
    '',
    '画面内容与布局',
    plan.imagePromptSections.contentLayout,
    '',
    '摄影机与成像',
    plan.imagePromptSections.cameraImaging,
    '',
    '负面词',
    plan.imagePromptSections.negativeTerms.join('，')
  ].join('\n');
}

function validatePanelCount(value: number): asserts value is StoryboardBoardPanelCount {
  if (![3, 4, 6, 9].includes(value)) throw new Error('Storyboard board panel count must be 3, 4, 6, or 9.');
}
