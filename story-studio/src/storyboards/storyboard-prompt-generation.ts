import type { AgentGenerationResult, AgentProvider, AgentRequest } from '../providers/contracts.js';
import type { Script, StoryboardAssetReference, StoryboardEvidence, StoryboardSegmentDraft, StyleSelection } from '../domain/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';
import { partitionAgentDraftValidationIssues } from '../validation/agent-draft-validation.ts';
import { productionCheckpoint } from '../workers/production-context.ts';
import { runImageTaskQueue } from '../workers/image-task-queue.ts';

export const STORYBOARD_PROMPT_SCHEMA_NAME = 'prism_autodrama_storyboard_segments_v3';
export const DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC = 15;

export interface StoryboardPromptGenerationInput {
  script: Script;
  styleSelection: StyleSelection;
  assets: StoryboardAssetReference[];
  segmentDurationSec?: number;
  maxOutputTokens?: number;
  concurrency?: number;
  preferences?: Record<string, unknown>;
}

export interface StoryboardSegmentPlanItem {
  segmentKey: string;
  sceneKey: string;
  sceneKeys: string[];
  order: number;
  startSec: number;
  endSec: number;
  targetDurationSec: number;
  endingSceneKey: string;
  endsAtSceneBoundary: boolean;
}

export interface StoryboardPromptGenerationDraft {
  segments: StoryboardSegmentDraft[];
}

interface StoryboardSemanticSegmentDraft extends Omit<StoryboardSegmentDraft, 'referenceAssetIds'> {}

interface StoryboardSemanticGenerationDraft {
  segments: StoryboardSemanticSegmentDraft[];
}

export class StoryboardPromptValidationError extends Error {
  readonly issues: string[];
  readonly diagnostics: Record<string, unknown> | undefined;
  constructor(issues: string[], diagnostics?: Record<string, unknown>) {
    super(`Storyboard prompt validation failed: ${issues.join('; ')}`);
    this.name = 'StoryboardPromptValidationError';
    this.issues = issues;
    this.diagnostics = diagnostics;
    Object.defineProperty(this, 'diagnostics', { enumerable: false });
  }
}

export function buildStoryboardEvidenceCatalog(script: Script): StoryboardEvidence[] {
  return script.scenes.flatMap((scene) => [
    ...splitAction(scene.action).map((text, index) => ({ evidenceId: `B-${scene.sceneKey}-A${String(index + 1).padStart(2, '0')}`, sceneKey: scene.sceneKey, kind: 'action' as const, text })),
    ...scene.dialogue.map((line, index) => ({ evidenceId: `B-${scene.sceneKey}-D${String(index + 1).padStart(2, '0')}`, sceneKey: scene.sceneKey, kind: 'dialogue' as const, text: line.text, speakerName: line.speakerName, delivery: line.delivery, speechKind: line.kind })),
    ...scene.soundCues.map((text, index) => ({ evidenceId: `B-${scene.sceneKey}-S${String(index + 1).padStart(2, '0')}`, sceneKey: scene.sceneKey, kind: 'sound' as const, text }))
  ]);
}

export function buildStoryboardSegmentPlan(script: Script, segmentDurationSec = DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC): StoryboardSegmentPlanItem[] {
  validateSegmentDuration(segmentDurationSec);
  const totalDurationSec = script.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  const slotCount = Math.ceil(totalDurationSec / segmentDurationSec);
  const allocatedSceneGroups = allocateSceneGroups(script.scenes.map((scene) => ({ sceneKey: scene.sceneKey, durationSec: scene.durationSec })), slotCount);
  const plan: StoryboardSegmentPlanItem[] = [];
  for (let startSec = 0; startSec < totalDurationSec; startSec += segmentDurationSec) {
    const endSec = Math.min(totalDurationSec, startSec + segmentDurationSec);
    const sceneKeys = allocatedSceneGroups[plan.length] ?? [script.scenes.at(-1)?.sceneKey ?? ''];
    const sceneKey = sceneKeys[0] ?? '';
    const endingSceneKey = sceneKeys.at(-1) ?? sceneKey;
    const nextSceneKey = allocatedSceneGroups[plan.length + 1]?.[0];
    plan.push({
      segmentKey: `SEG${String(plan.length + 1).padStart(3, '0')}`,
      sceneKey,
      sceneKeys,
      order: plan.length + 1,
      startSec,
      endSec,
      targetDurationSec: endSec - startSec,
      endingSceneKey,
      endsAtSceneBoundary: !nextSceneKey || nextSceneKey !== endingSceneKey
    });
  }
  return plan;
}

export function buildStoryboardPromptRequest(input: StoryboardPromptGenerationInput): AgentRequest {
  validateInput(input);
  const segmentDurationSec = input.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC;
  const segmentPlan = buildStoryboardSegmentPlan(input.script, segmentDurationSec);
  const segmentSlots = segmentPlan.map(({ segmentKey, sceneKey, sceneKeys, endingSceneKey, order, startSec, endSec, targetDurationSec }) => ({ segmentKey, sceneKey, sceneKeys, endingSceneKey, order, startSec, endSec, targetDurationSec }));
  const characterNames = storyboardCharacterNames(input);
  const sceneAssets = input.assets.filter((asset) => asset.assetKind === 'scene');
  const sceneAssetKeys = uniqueStrings(sceneAssets.map((asset) => asset.sceneAssetKey).filter(nonEmpty));
  const sceneViewKeys = uniqueStrings(sceneAssets.map((asset) => asset.viewKey).filter(nonEmpty));
  const availablePropStates = uniqueStrings(input.assets.filter((asset) => asset.assetKind === 'prop').map((asset) => asset.stateKey).filter(nonEmpty));
  return {
    operation: 'generate-concise-storyboard-segments',
    schemaName: STORYBOARD_PROMPT_SCHEMA_NAME,
    maxOutputTokens: input.maxOutputTokens ?? TEXT_TOKEN_BUDGETS.storyboardSegments,
    instructions: [
      '你是负责整集节奏分配的总导演兼短剧分镜师。只输出类似分镜卡片的简洁中文描述，不写五段式生图提示词，不写长篇导演阐释。',
      `程序已沿整集时间轴建立固定${segmentDurationSec}秒的segmentSlots。除整集结尾不足${segmentDurationSec}秒外，每段时长必须固定为${segmentDurationSec}秒；不得因场次原估时长另拆出2秒、4秒等短尾段。segments必须与segmentSlots数量、segmentKey、order和duration逐项完全一致。`,
      '程序已经把连续场次分配到固定槽位，并在segmentSlots.sceneKeys中列出每段实际覆盖的一个或多个场次。按该范围完成内容；sceneKey填写sceneKeys中的第一项。一个固定时长段可以包含自然硬切和多个连续场次，不得因为场次数多而中止或遗漏。',
      'storyboardText建议80至220个中文字符，像一张分镜卡片：先写时间与地点，时间使用白天、夜晚等完整中文表达，再写本段人物、核心动作、表情、空间关系、基本景别或机位；本段有对白时保留逐字对白。不要分基础设定、摄影风格等章节。',
      'actionEvidenceIds和dialogueEvidenceIds只能使用当前segmentSlots.sceneKeys所列场次的证据ID；每条action与dialogue证据在整集必须恰好出现一次，并分别保持原顺序。选中的对白必须逐字出现在storyboardText中，不能改写、拆句、换人或提前。',
      'soundCueIds只能引用当前segmentSlots.sceneKeys所列场次的声音，可按需要重复。不得新增旁白、背景音乐、抽象低鸣、动物声或剧本外声音。',
      characterNames.length
        ? `characters只能从剧本或已批准人物中选择：${characterNames.join('、')}。没有人物的纯环境镜头可返回空数组；人物没有独立资产时仍可依据剧本出现。`
        : 'characters只能填写当前剧本明确出现的人物；如本段没有人物则返回空数组。当前没有独立人物资产，不得因此中止分镜。',
      sceneAssetKeys.length
        ? `本段需要已批准场景参考时，sceneAssetKey从${sceneAssetKeys.join('、')}中选择，sceneViewKey从${sceneViewKeys.join('、')}中选择；不需要资产时分别返回none和text-only。不要输出其他资产ID。`
        : '当前没有独立场景资产，所有分段的sceneAssetKey必须为none，sceneViewKey必须为text-only；直接依据剧本中的地点、时间和空间信息设计分镜。',
      availablePropStates.length ? `propStateKey只能使用none、${availablePropStates.join('、')}；只有本段确实出现已批准关键道具时才选择对应状态。` : '当前没有独立道具资产，所有分段的propStateKey必须为none。',
      '保持剧本中的人物身份、空间轴线、动作先后和因果结果，不提前展示后一段或下一场事件，不引入剧本之外的人物、道具、地点或结局。',
      'dialogue证据中的speechKind必须原样执行：internal_monologue是可听见的内心声，人物嘴唇闭合且没有口型；voiceover是画外音，不给画面人物配口型，画外旁白不需要加入characters；dialogue才使用说话口型与现场对白。',
      '如果场景包含transitionDirection，必须在该场最后一个segment完整执行；其中引号内的字幕、标题或其他屏幕文字必须逐字保留，不得被普通“无字幕”习惯覆盖。',
      'transition字段描述当前固定段结尾的转场；段内跨场时，把内部切换按剧情顺序直接写入storyboardText和后续画格，不需要额外拆成短段。证据ID只作为结构化字段，不写进storyboardText。'
    ].join('\n'),
    input: {
      script: input.script,
      segmentDurationSec,
      segmentSlots,
      evidenceCatalog: buildStoryboardEvidenceCatalog(input.script),
      approvedAssets: input.assets,
      styleSelection: { id: input.styleSelection.id, version: input.styleSelection.version, name: input.styleSelection.name },
      preferences: input.preferences ?? {}
    },
    outputSchema: storyboardPromptOutputSchema(input)
  };
}

export async function generateStoryboardPrompts(provider: AgentProvider, input: StoryboardPromptGenerationInput): Promise<AgentGenerationResult<StoryboardPromptGenerationDraft>> {
  const result = await provider.generate<StoryboardSemanticGenerationDraft>(buildStoryboardPromptRequest(input));
  const normalizedOutput = normalizeStoryboardPromptDraft(result.output, input);
  try {
    validateStoryboardPromptDraft(normalizedOutput, input);
  } catch (error) {
    if (error instanceof StoryboardPromptValidationError) {
      throw new StoryboardPromptValidationError(error.issues, {
        providerId: result.providerId,
        model: result.model,
        externalTaskId: result.externalTaskId,
        completedAt: result.completedAt,
        elapsedMs: result.elapsedMs,
        usage: result.usage,
        draft: normalizedOutput
      });
    }
    throw error;
  }
  return { ...result, output: normalizedOutput };
}

export function buildStoryboardSegmentRepairRequest(
  input: StoryboardPromptGenerationInput,
  draft: StoryboardPromptGenerationDraft,
  segmentKey: string,
  issues: string[],
): AgentRequest {
  const segment = draft.segments.find((item) => item.segmentKey === segmentKey);
  const slot = buildStoryboardSegmentPlan(input.script, input.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC).find((item) => item.segmentKey === segmentKey);
  if (!segment || !slot) throw new StoryboardPromptValidationError([`${segmentKey} repair target is unavailable`]);
  return {
    operation: 'repair-concise-storyboard-segment',
    schemaName: `${STORYBOARD_PROMPT_SCHEMA_NAME}_repair`,
    maxOutputTokens: Math.min(input.maxOutputTokens ?? TEXT_TOKEN_BUDGETS.storyboardSegments, 8_000),
    instructions: [
      '你是文字分镜审校 Agent。只修改当前这一段，不重写其他已正确分镜。',
      '必须修复 segmentIssues 指出的对白逐字保留、说话人、对白所属段和时间顺序问题。',
      '保留当前段已正确的标题、动作、场景、角色和转场；不增加剧本外的对白、人物或事件。',
      'segmentKey、sceneKey、order和durationSec必须与currentSlot完全一致。证据ID只能使用currentSlot.sceneKeys对应的evidenceCatalog。',
      '只输出JSON结构中的segment对象。',
    ].join('\n'),
    input: {
      currentSlot: slot,
      currentSegment: segment,
      segmentIssues: issues,
      siblingSegments: draft.segments.map(({ segmentKey: key, title, storyboardText, dialogueEvidenceIds }) => ({ segmentKey: key, title, storyboardText, dialogueEvidenceIds })),
      evidenceCatalog: buildStoryboardEvidenceCatalog(input.script),
      approvedAssets: input.assets,
      preferences: input.preferences ?? {},
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { segment: storyboardSegmentOutputSchema(input) },
      required: ['segment'],
    },
  };
}

export async function generateStoryboardPromptsWithRepair(
  provider: AgentProvider,
  input: StoryboardPromptGenerationInput,
): Promise<AgentGenerationResult<StoryboardPromptGenerationDraft> & { repairAttempted?: boolean; repairedSegmentKeys?: string[] }> {
  try {
    return await generateStoryboardPrompts(provider, input);
  } catch (error) {
    if (!(error instanceof StoryboardPromptValidationError)) throw error;
    const initialDraft = error.diagnostics?.draft;
    if (!initialDraft || typeof initialDraft !== 'object' || !Array.isArray((initialDraft as StoryboardPromptGenerationDraft).segments)) throw error;
    return repairStoryboardPrompts(provider, input, initialDraft as StoryboardPromptGenerationDraft, error.issues, error.diagnostics);
  }
}

export async function repairStoryboardPrompts(provider: AgentProvider, input: StoryboardPromptGenerationInput, initialDraft: StoryboardPromptGenerationDraft, issues: string[], diagnostics: Record<string, unknown> = {}) {
    const draft = structuredClone(initialDraft);
    const repairKeys = [...new Set(issues.flatMap((issue) => String(issue).match(/SEG\d{3}/giu) ?? []).map((key) => key.toUpperCase()))]
      .filter((key) => draft.segments.some((segment) => segment.segmentKey === key));
    if (repairKeys.length === 0) throw new StoryboardPromptValidationError(issues, { ...diagnostics, draft });

    const repaired = new Map<string, StoryboardSemanticSegmentDraft>();
    const repairResults: AgentGenerationResult<{ segment: StoryboardSemanticSegmentDraft }>[] = [];
    const outcomes = await runImageTaskQueue(repairKeys, async (segmentKey) => {
          const segmentIssues = issues.filter((issue) => String(issue).includes(segmentKey));
          const result = await provider.generate<{ segment: StoryboardSemanticSegmentDraft }>(buildStoryboardSegmentRepairRequest(input, draft, segmentKey, segmentIssues.length ? segmentIssues : issues));
          if (result.output.segment.segmentKey !== segmentKey) throw new Error(`${segmentKey} 修复返回了其他段号。`);
          repaired.set(segmentKey, result.output.segment);
          repairResults.push(result);
          productionCheckpoint({ segments: normalizeStoryboardPromptDraft({ segments: draft.segments.map(segment => repaired.get(segment.segmentKey) ?? segment) }, input).segments, repairAttempted: true });
          return result;
    }, { concurrency: Math.max(1, Math.min(4, input.concurrency ?? 2)), stopSchedulingOnFailure: false });

    const merged = { segments: draft.segments.map((segment) => repaired.get(segment.segmentKey) ?? segment) };
    const normalized = normalizeStoryboardPromptDraft(merged, input);
    const failures = outcomes.filter(outcome => outcome.status === 'rejected');
    if (failures.length) throw new StoryboardPromptValidationError(issues, { ...diagnostics, draft: normalized, repairAttempted: true, repairedSegmentKeys: [...repaired.keys()], repairFailure: failures.map(failure => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join('; ') });
    try {
      validateStoryboardPromptDraft(normalized, input);
    } catch (validationError) {
      if (validationError instanceof StoryboardPromptValidationError) {
        throw new StoryboardPromptValidationError(validationError.issues, { ...diagnostics, draft: normalized, repairAttempted: true, repairedSegmentKeys: repairKeys });
      }
      throw validationError;
    }
    const finalResult = repairResults.at(-1)!;
    return { ...finalResult, output: normalized, repairAttempted: true, repairedSegmentKeys: repairKeys };
}

export type StoryboardOutlineItem = { segmentKey: string; actionEvidenceIds: string[]; dialogueEvidenceIds: string[]; soundCueIds: string[]; intent: string };

export function collectStoryboardOutlineIssues(outline: unknown, input: StoryboardPromptGenerationInput): string[] {
  const slots = buildStoryboardSegmentPlan(input.script, input.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC);
  const catalog = buildStoryboardEvidenceCatalog(input.script);
  if (!Array.isArray(outline)) return ['整集规划缺少分段列表。'];
  const issues: string[] = [];
  if (JSON.stringify(outline.map(item => item?.segmentKey)) !== JSON.stringify(slots.map(slot => slot.segmentKey))) issues.push(`整集规划段号或顺序不一致，应为：${slots.map(slot => slot.segmentKey).join('、')}。`);
  for (const item of outline) {
    if (Array.isArray(item?.actionEvidenceIds) && Array.isArray(item?.dialogueEvidenceIds) && item.actionEvidenceIds.length + item.dialogueEvidenceIds.length === 0) issues.push(`${item.segmentKey} 没有分配动作或对白依据，请调整分段内容。`);
  }
  for (const [field, kind, label] of [['actionEvidenceIds', 'action', '动作'], ['dialogueEvidenceIds', 'dialogue', '对白'], ['soundCueIds', 'sound', '声音']] as const) {
    const uses = new Map<string, string[]>();
    for (const item of outline) {
      if (!Array.isArray(item?.[field])) { issues.push(`${item?.segmentKey ?? '未知段'} 缺少${label}编号列表。`); continue; }
      const slot = slots.find(slot => slot.segmentKey === item.segmentKey);
      for (const id of item[field]) {
        const evidence = catalog.find(e => e.evidenceId === id && e.kind === kind);
        if (!evidence) issues.push(`${item.segmentKey} 引用了未知${label}编号 ${String(id)}。`);
        else if (!slot?.sceneKeys.includes(evidence.sceneKey)) issues.push(`${item.segmentKey} 引用了其他场次的${label} ${id}「${evidence.text}」。`);
        uses.set(id, [...(uses.get(id) ?? []), item.segmentKey]);
      }
    }
    if (kind === 'sound') continue;
    const expected = catalog.filter(e => e.kind === kind);
    for (const evidence of expected) {
      const owners = uses.get(evidence.evidenceId) ?? [];
      if (!owners.length) issues.push(`遗漏${label} ${evidence.evidenceId}「${evidence.text}」。`);
      if (owners.length > 1) issues.push(`${label} ${evidence.evidenceId}「${evidence.text}」重复分配到 ${owners.join('、')}，每条只能分配一次。`);
    }
    const actual = [...new Set(outline.flatMap(item => Array.isArray(item?.[field]) ? item[field] : []))].filter(id => expected.some(e => e.evidenceId === id));
    const present = expected.filter(e => uses.has(e.evidenceId));
    const mismatch = actual.findIndex((id, index) => id !== present[index]?.evidenceId);
    if (mismatch >= 0) issues.push(`${label}顺序错误：${uses.get(actual[mismatch])?.join('、')} 的 ${actual[mismatch]} 应排在 ${present[mismatch]?.evidenceId} 之后。`);
  }
  return issues;
}

// Only remove redundant ownership when every other completeness, order and scene
// constraint is already satisfied. The caller retains the original plan for audit.
export function reconcileStoryboardOutline(outline: StoryboardOutlineItem[], input: StoryboardPromptGenerationInput) {
  const issues = collectStoryboardOutlineIssues(outline, input);
  if (!issues.length) return { outline, adjustments: [] as string[] };
  const seen = new Set<string>();
  const candidate = Array.isArray(outline) ? outline.map(item => ({ ...item,
    actionEvidenceIds: Array.isArray(item?.actionEvidenceIds) ? item.actionEvidenceIds.filter(id => {
      if (seen.has(id)) return false;
      seen.add(id); return true;
    }) : item?.actionEvidenceIds,
  })) : outline;
  if (issues.every(issue => issue.startsWith('动作 ') && issue.includes('重复分配到')) && !collectStoryboardOutlineIssues(candidate, input).length) {
    return { outline: candidate, adjustments: issues.map(issue => `${issue} 已保留首次分配。`) };
  }
  return { outline, adjustments: [] as string[] };
}

export async function generateStoryboardPromptsBySegment(provider: AgentProvider, input: StoryboardPromptGenerationInput, saved?: { segments?: StoryboardSegmentDraft[]; outline?: StoryboardOutlineItem[]; repairOnly?: boolean }) {
  const base = buildStoryboardPromptRequest(input);
  const slots = buildStoryboardSegmentPlan(input.script, input.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC);
  const catalog = buildStoryboardEvidenceCatalog(input.script);
  const byKey = new Map((saved?.segments ?? []).filter(x => slots.some(slot => slot.segmentKey === x.segmentKey)).map(x => [x.segmentKey, x]));
  let outline = saved?.outline;
  let originalOutline: StoryboardOutlineItem[] | undefined;
  let outlineAdjustments: string[] = [];
  if (saved?.repairOnly && !byKey.size && !outline?.length) throw new Error('当前项目没有保存可修复的文字分镜草稿，请使用“生成文字分镜”建立初稿。');
  if (outline?.length) productionCheckpoint({ outline, segments: [...byKey.values()], validationIssues: collectStoryboardOutlineIssues(outline, input) });
  const savedIssues = outline?.length ? collectStoryboardOutlineIssues(outline, input) : [];
  if (outline?.length && !byKey.size) {
    const reconciled = reconcileStoryboardOutline(outline, input);
    if (reconciled.adjustments.length) { originalOutline = outline; outline = reconciled.outline; outlineAdjustments = reconciled.adjustments; }
  }
  const outlineIssues = outline?.length ? collectStoryboardOutlineIssues(outline, input) : [];
  if ((!outline?.length && byKey.size < slots.length) || (saved?.repairOnly && outlineIssues.length)) {
    const list = { type: 'array', items: { type: 'string' } };
    const result = await provider.generate<{ items: StoryboardOutlineItem[] }>({
      operation: outlineIssues.length ? 'repair-storyboard-evidence' : 'plan-storyboard-evidence', schemaName: 'storyboard_evidence_plan_v1', maxOutputTokens: Math.min(16000, 2000 + slots.length * 500),
      instructions: '你是整集分镜导演。根据固定时间槽位分配动作、对白和声音证据，每条动作和对白分别按原顺序恰好分配一次。同一场跨多个段时，后续段可延续已发生动作形成的状态，actionEvidenceIds可为空；每条完整动作编号只归属首次执行它的段，不能因跨段延续而重复分配。每段intent只用一句中文说明叙事目的。保留已有段落的证据分配。修复时逐条处理validationIssues。只输出JSON，不展开分镜正文。',
      input: { slots, evidenceCatalog: catalog, existingSegments: [...byKey.values()], ...(outlineIssues.length ? { rejectedOutline: outline, validationIssues: savedIssues } : {}) },
      outputSchema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', minItems: slots.length, maxItems: slots.length, items: { type: 'object', additionalProperties: false, required: ['segmentKey', 'actionEvidenceIds', 'dialogueEvidenceIds', 'soundCueIds', 'intent'], properties: { segmentKey: { type: 'string' }, actionEvidenceIds: list, dialogueEvidenceIds: list, soundCueIds: list, intent: { type: 'string' } } } } } },
    });
    outline = result.output.items;
    if (!byKey.size) {
      const reconciled = reconcileStoryboardOutline(outline, input);
      if (reconciled.adjustments.length) { originalOutline = outline; outline = reconciled.outline; outlineAdjustments = reconciled.adjustments; }
    }
  }
  if (outline?.length) {
    const issues = collectStoryboardOutlineIssues(outline, input);
    for (const segment of byKey.values()) {
      const item = outline.find(item => item?.segmentKey === segment.segmentKey);
      if (item && ['actionEvidenceIds', 'dialogueEvidenceIds'].some(field => JSON.stringify((item as any)[field]) !== JSON.stringify((segment as any)[field]))) issues.push(`${segment.segmentKey} 规划修改了已保存正文的证据分配，请保留原分配。`);
    }
    productionCheckpoint({ outline, originalOutline, outlineAdjustments, segments: [...byKey.values()], validationIssues: issues });
    if (issues.length) throw new StoryboardPromptValidationError(issues, { outline, draft: { outline, segments: [...byKey.values()] } });
  } else if (byKey.size < slots.length) {
    throw new StoryboardPromptValidationError(['整集规划缺少分段列表。'], { draft: { outline: outline ?? [], segments: [...byKey.values()] } });
  }
  const failures: Array<{ segmentKey: string; message: string }> = [];
  await runImageTaskQueue(slots.filter(slot => !byKey.has(slot.segmentKey)), async slot => {
    try {
      const result = await provider.generate<{ segment: StoryboardSemanticSegmentDraft }>({
        ...base, operation: 'generate-storyboard-segment', schemaName: 'storyboard_single_segment_v1', maxOutputTokens: 8000,
        instructions: `${base.instructions}\n本次只展开currentSlot这一段，按sharedOutline中该段的证据分配写作。返回segment对象，其他段只作为连续性参考。`,
        input: { ...(base.input as object), currentSlot: slot, sharedOutline: outline, segmentSlots: [slot] },
        outputSchema: { type: 'object', additionalProperties: false, required: ['segment'], properties: { segment: storyboardSegmentOutputSchema(input) } },
      });
      if (result.output.segment.segmentKey !== slot.segmentKey) throw new Error(`${slot.segmentKey} 返回段号不一致。`);
      const assigned = outline?.find(item => item.segmentKey === slot.segmentKey);
      if (assigned && ['actionEvidenceIds', 'dialogueEvidenceIds'].some(field => JSON.stringify((assigned as any)[field]) !== JSON.stringify((result.output.segment as any)[field]))) throw new Error(`${slot.segmentKey} 的动作或对白证据与整集分配不一致。`);
      byKey.set(slot.segmentKey, result.output.segment as StoryboardSegmentDraft);
      const draft = normalizeStoryboardPromptDraft({ segments: slots.map(s => byKey.get(s.segmentKey)).filter(Boolean) as StoryboardSegmentDraft[] }, input);
      productionCheckpoint({ outline, segments: draft.segments, validationErrors: [...failures] });
    } catch (error) { failures.push({ segmentKey: slot.segmentKey, message: error instanceof Error ? error.message : String(error) }); }
  }, { concurrency: Math.max(1, Math.min(4, input.concurrency ?? 2)), stopSchedulingOnFailure: false });
  const draft = normalizeStoryboardPromptDraft({ segments: slots.map(slot => byKey.get(slot.segmentKey)).filter(Boolean) as StoryboardSegmentDraft[] }, input);
  if (failures.length) return { ...draft, outline, validationErrors: failures, complete: false, error: failures.map(x => `${x.segmentKey}：${x.message}`).join('；') };
  try { validateStoryboardPromptDraft(draft, input); }
  catch (error) {
    if (!(error instanceof StoryboardPromptValidationError)) throw error;
    if (!saved?.repairOnly) return { ...draft, outline, complete: false, repairAttempted: false, validationIssues: error.issues, error: error.message };
    try {
      const repaired = await repairStoryboardPrompts(provider, input, draft, error.issues);
      return { ...repaired.output, outline, complete: true, repairAttempted: true, repairedSegmentKeys: repaired.repairedSegmentKeys, warnings: collectStoryboardValidationWarnings(repaired.output, input) };
    } catch (repairError) {
      const detail = repairError as StoryboardPromptValidationError;
      const preserved = detail.diagnostics?.draft as StoryboardPromptGenerationDraft | undefined;
      return { ...(preserved ?? draft), outline, complete: false, repairAttempted: true, validationIssues: detail.issues ?? [detail.message], error: detail.message };
    }
  }
  return { ...draft, outline, complete: true, warnings: collectStoryboardValidationWarnings(draft, input) };
}

export function normalizeStoryboardPromptDraft(
  draft: StoryboardPromptGenerationDraft | StoryboardSemanticGenerationDraft,
  input: StoryboardPromptGenerationInput
): StoryboardPromptGenerationDraft {
  const evidence = buildStoryboardEvidenceCatalog(input.script);
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  const evidenceOrder = new Map(evidence.map((item, index) => [item.evidenceId, index]));
  const plan = buildStoryboardSegmentPlan(input.script, input.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC);
  const sceneByKey = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene]));
  const approvedPropStates = new Set(input.assets.filter((asset) => asset.assetKind === 'prop').map((asset) => asset.stateKey).filter(nonEmpty));
  const normalizeIds = (ids: unknown, kind: StoryboardEvidence['kind'], sceneKeys: string[]): string[] =>
    Array.isArray(ids)
      ? [...new Set(ids.filter((id): id is string => {
          if (typeof id !== 'string') return false;
          const item = evidenceById.get(id);
          return item?.kind === kind && sceneKeys.includes(item.sceneKey);
        }))].sort(
          (left, right) => (evidenceOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (evidenceOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
        )
      : [];
  const semanticSegments = Array.isArray(draft.segments) ? draft.segments : [];
  const normalizedSegments = semanticSegments.map((segment, index) => {
    const source = segment && typeof segment === 'object' ? structuredClone(segment) : ({} as StoryboardSemanticSegmentDraft);
    const expected = plan.find(item => item.segmentKey === source.segmentKey) ?? plan[index];
    const returnedSceneKey = sceneByKey.has(source.sceneKey) ? source.sceneKey : expected?.sceneKey ?? source.sceneKey;
    const sceneKeys = expected?.sceneKeys?.length && expected.sceneKeys.length > 1 ? expected.sceneKeys : [returnedSceneKey];
    const sceneKey = sceneKeys[0] ?? returnedSceneKey;
    const knownCharacterNames = new Set(storyboardCharacterNames(input));
    const characters = uniqueStrings(Array.isArray(source.characters)
      ? source.characters.filter(nonEmpty).filter((name) => knownCharacterNames.size === 0 || knownCharacterNames.has(name))
      : []);
    const actionEvidenceIds = normalizeIds(source.actionEvidenceIds, 'action', sceneKeys);
    const dialogueEvidenceIds = normalizeIds(source.dialogueEvidenceIds, 'dialogue', sceneKeys);
    const soundCueIds = normalizeIds(source.soundCueIds, 'sound', sceneKeys);
    const compatibleSceneAssets = input.assets.filter((asset) => asset.assetKind === 'scene' && (!asset.sourceSceneKeys?.length || asset.sourceSceneKeys.some((key) => sceneKeys.includes(key))));
    const textOnlyScene = source.sceneAssetKey === 'none' || source.sceneViewKey === 'text-only' || compatibleSceneAssets.length === 0;
    const selectedSceneAsset = textOnlyScene
      ? undefined
      : compatibleSceneAssets.find((asset) => asset.sceneAssetKey === source.sceneAssetKey && asset.viewKey === source.sceneViewKey)
        ?? compatibleSceneAssets.find((asset) => asset.sceneAssetKey === source.sceneAssetKey)
        ?? compatibleSceneAssets.find((asset) => asset.viewKey === source.sceneViewKey)
        ?? compatibleSceneAssets[0];
    const requestedPropState = source.propStateKey;
    const propStateKey = requestedPropState === 'destroyed' && approvedPropStates.has('activated')
      ? 'destroyed'
      : approvedPropStates.has(requestedPropState)
        ? requestedPropState
        : 'none';
    const transition = ['cut', 'continuous', 'fade_to_black'].includes(source.transition) ? source.transition : 'cut';
    return {
      ...source,
      segmentKey: expected?.segmentKey ?? source.segmentKey,
      sceneKey,
      sceneKeys,
      order: expected?.order ?? source.order,
      durationSec: expected?.targetDurationSec ?? source.durationSec,
      characters,
      sceneAssetKey: selectedSceneAsset?.sceneAssetKey,
      sceneViewKey: selectedSceneAsset?.viewKey ?? 'text-only',
      propStateKey,
      actionEvidenceIds,
      dialogueEvidenceIds,
      soundCueIds,
      transition,
      referenceAssetIds: []
    } as StoryboardSegmentDraft;
  });

  for (let index = 0; index < normalizedSegments.length; index += 1) {
    const segment = normalizedSegments[index];
    const endingSceneKey = (segment.sceneKeys ?? [segment.sceneKey]).at(-1) ?? segment.sceneKey;
    const nextSlot = plan[plan.findIndex(slot => slot.segmentKey === segment.segmentKey) + 1];
    const nextSceneKey = nextSlot?.sceneKey;
    if (nextSceneKey === endingSceneKey) continue;
    const scene = sceneByKey.get(endingSceneKey);
    if (scene) segment.transition = scene.transitionOut;
  }

  for (const dialogue of evidence.filter((item) => item.kind === 'dialogue')) {
    const sceneIndexes = normalizedSegments.map((segment, index) => (segment.sceneKeys ?? [segment.sceneKey]).includes(dialogue.sceneKey) ? index : -1).filter((index) => index >= 0);
    const declaredIndexes = sceneIndexes.filter((index) => normalizedSegments[index].dialogueEvidenceIds.includes(dialogue.evidenceId));
    const contentIndexes = sceneIndexes.filter((index) => storyboardTextContainsDialogue(normalizedSegments[index].storyboardText, dialogue.text));
    const ownerIndex = contentIndexes.length === 1
      ? contentIndexes[0]
      : declaredIndexes.length === 1
        ? declaredIndexes[0]
        : declaredIndexes.find((index) => contentIndexes.includes(index));
    if (ownerIndex === undefined) continue;
    for (const index of sceneIndexes) normalizedSegments[index].dialogueEvidenceIds = normalizedSegments[index].dialogueEvidenceIds.filter((id) => id !== dialogue.evidenceId);
    normalizedSegments[ownerIndex].dialogueEvidenceIds.push(dialogue.evidenceId);
  }

  for (const segment of normalizedSegments) {
    segment.dialogueEvidenceIds.sort((left, right) => (evidenceOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (evidenceOrder.get(right) ?? Number.MAX_SAFE_INTEGER));
    for (const id of segment.dialogueEvidenceIds) {
      const dialogue = evidenceById.get(id);
      if (dialogue?.speechKind === 'dialogue' && dialogue.speakerName && !segment.characters.includes(dialogue.speakerName)) {
        segment.characters.push(dialogue.speakerName);
      }
    }
    segment.referenceAssetIds = resolveReferenceAssetIds(segment, input.assets);
  }
  return {
    segments: normalizedSegments
  };
}

export function collectStoryboardValidationWarnings(
  draft: StoryboardPromptGenerationDraft,
  input: StoryboardPromptGenerationInput
): string[] {
  const evidence = buildStoryboardEvidenceCatalog(input.script);
  const expectedActions = evidence.filter((item) => item.kind === 'action').map((item) => item.evidenceId);
  const receivedActions = draft.segments.flatMap((segment) => segment.actionEvidenceIds ?? []);
  const missing = expectedActions.filter((id) => !receivedActions.includes(id));
  const duplicates = [...new Set(receivedActions.filter((id, index) => receivedActions.indexOf(id) !== index))];
  const warnings: string[] = [];
  if (receivedActions.join('\0') !== expectedActions.join('\0')) {
    warnings.push('动作证据覆盖或顺序与剧本目录不完全一致，请在分镜卡片审核时重点检查动作连续性。');
    if (missing.length) warnings.push(`未绑定动作证据：${missing.join('、')}`);
    if (duplicates.length) warnings.push(`重复动作证据：${duplicates.join('、')}`);
  }
  const verboseSegments = draft.segments.filter((segment) => typeof segment.storyboardText === 'string' && segment.storyboardText.length > 700).map((segment) => segment.segmentKey);
  if (verboseSegments.length) warnings.push(`${verboseSegments.join('、')}的文字分镜较长；内容已经保留，可在确认前按需精简。`);
  return warnings;
}

export function validateStoryboardPromptDraft(draft: StoryboardPromptGenerationDraft, input: StoryboardPromptGenerationInput): string[] {
  validateInput(input);
  const plan = buildStoryboardSegmentPlan(input.script, input.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC);
  const issues: string[] = [];
  if (!Array.isArray(draft.segments) || draft.segments.length !== plan.length) throw new StoryboardPromptValidationError([`segments must contain exactly ${plan.length} items`]);
  const evidence = buildStoryboardEvidenceCatalog(input.script);
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  const assetsById = new Map(input.assets.map((item) => [item.assetId, item]));
  const requiredDialogue = evidence.filter((item) => item.kind === 'dialogue').map((item) => item.evidenceId);
  const usedDialogue: string[] = [];

  draft.segments.forEach((segment, index) => {
    const expected = plan[index];
    const sceneKeys = segment.sceneKeys ?? [segment.sceneKey];
    if (segment.segmentKey !== expected.segmentKey || segment.sceneKey !== sceneKeys[0] || segment.order !== expected.order || segment.durationSec !== expected.targetDurationSec) issues.push(`segment ${index + 1} must match ${expected.segmentKey} fixed slot`);
    const selectedAction = validateEvidenceIds(segment.actionEvidenceIds, 'action', sceneKeys, segment.segmentKey, evidenceById, issues);
    const selectedDialogue = validateEvidenceIds(segment.dialogueEvidenceIds, 'dialogue', sceneKeys, segment.segmentKey, evidenceById, issues, usedDialogue);
    validateEvidenceIds(segment.soundCueIds, 'sound', sceneKeys, segment.segmentKey, evidenceById, issues);
    if (selectedAction.length + selectedDialogue.length === 0) issues.push(`${segment.segmentKey} must carry story evidence`);
    if (!nonEmpty(segment.title) || !nonEmpty(segment.storyboardText)) issues.push(`${segment.segmentKey} requires storyboard title and text`);
    for (const item of selectedDialogue) {
      if (!storyboardTextContainsDialogue(segment.storyboardText, item.text)) issues.push(`${segment.segmentKey} must preserve dialogue ${item.evidenceId} verbatim`);
      if (item.speechKind === 'dialogue' && item.speakerName && !segment.characters.includes(item.speakerName)) issues.push(`${segment.segmentKey} omits dialogue speaker ${item.speakerName}`);
    }
    validateAssets(segment, assetsById, input.assets, issues);
  });

  const sceneOrder = new Map(input.script.scenes.map((scene, index) => [scene.sceneKey, index]));
  const assignedSceneKeys = draft.segments.flatMap((segment) => segment.sceneKeys ?? [segment.sceneKey]);
  if (assignedSceneKeys.some((sceneKey) => !sceneOrder.has(sceneKey))) issues.push('segments contain a scene outside the approved script');
  const assignedOrder = assignedSceneKeys.map((sceneKey) => sceneOrder.get(sceneKey) ?? Number.MAX_SAFE_INTEGER);
  if (assignedOrder.some((value, index) => index > 0 && value < assignedOrder[index - 1])) issues.push('segment scenes must follow script order');
  const missingScenes = input.script.scenes.filter((scene) => !assignedSceneKeys.includes(scene.sceneKey)).map((scene) => scene.sceneKey);
  if (missingScenes.length) issues.push(`every script scene must receive at least one fixed segment; missing=${missingScenes.join(',')}`);

  if (usedDialogue.join('\0') !== requiredDialogue.join('\0')) issues.push(`dialogue evidence must be covered exactly once and in order; expected=${requiredDialogue.join(',')}; received=${usedDialogue.join(',')}`);
  for (const scene of input.script.scenes) {
    const sceneSegments = draft.segments.filter((segment) => (segment.sceneKeys ?? [segment.sceneKey]).includes(scene.sceneKey));
    const finalSegment = sceneSegments.at(-1);
    const endingSceneKey = finalSegment ? (finalSegment.sceneKeys ?? [finalSegment.sceneKey]).at(-1) : undefined;
    if (endingSceneKey === scene.sceneKey && finalSegment?.transition !== scene.transitionOut) issues.push(`${scene.sceneKey} final transition must match script`);
  }
  const report = partitionAgentDraftValidationIssues('storyboard-segment', issues);
  if (report.blockingIssues.length > 0) throw new StoryboardPromptValidationError(report.blockingIssues);
  return report.warnings;
}

export function groundStoryboardEvidence(segment: StoryboardSegmentDraft, script: Script): StoryboardEvidence[] {
  const byId = new Map(buildStoryboardEvidenceCatalog(script).map((item) => [item.evidenceId, item]));
  return [...segment.actionEvidenceIds, ...segment.dialogueEvidenceIds, ...segment.soundCueIds].map((id) => byId.get(id)).filter((item): item is StoryboardEvidence => Boolean(item));
}

function validateInput(input: StoryboardPromptGenerationInput): void {
  if (input.script.approval !== 'approved') throw new Error('Script must be approved before storyboard generation.');
  if (input.styleSelection.approval !== 'approved') throw new Error('Style must be approved before storyboard generation.');
  if (input.assets.some((asset) => asset.approval !== 'approved')) throw new Error('All supplied storyboard assets must be approved.');
  validateSegmentDuration(input.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC);
}

function validateSegmentDuration(value: number): void {
  if (!Number.isInteger(value) || value < 5 || value > 15) throw new Error('Storyboard segment duration must be an integer from 5 to 15 seconds.');
}

function validateEvidenceIds(ids: string[], kind: StoryboardEvidence['kind'], sceneKeys: string[], segmentKey: string, evidenceById: Map<string, StoryboardEvidence>, issues: string[], collector?: string[]): StoryboardEvidence[] {
  if (!Array.isArray(ids)) { issues.push(`${segmentKey} ${kind} evidence must be an array`); return []; }
  const selected: StoryboardEvidence[] = [];
  for (const id of ids) {
    const item = evidenceById.get(id);
    if (!item || item.kind !== kind || !sceneKeys.includes(item.sceneKey)) issues.push(`${segmentKey} has invalid ${kind} evidence ${id}`);
    else { selected.push(item); collector?.push(id); }
  }
  return selected;
}

function validateAssets(segment: StoryboardSegmentDraft, assetsById: Map<string, StoryboardAssetReference>, allAssets: StoryboardAssetReference[], issues: string[]): void {
  if (!Array.isArray(segment.referenceAssetIds) || new Set(segment.referenceAssetIds).size !== segment.referenceAssetIds.length) { issues.push(`${segment.segmentKey} reference assets must be unique`); return; }
  const selected = segment.referenceAssetIds.map((id) => assetsById.get(id));
  if (selected.some((asset) => !asset)) issues.push(`${segment.segmentKey} references unknown asset`);
  const present = selected.filter((asset): asset is StoryboardAssetReference => Boolean(asset));
  const sceneReferences = present.filter((asset) => asset.assetKind === 'scene');
  if (sceneReferences.length > 1) issues.push(`${segment.segmentKey} must not select more than one scene asset`);
  const sceneAsset = present.find((asset) => asset.assetKind === 'scene');
  if (segment.sceneAssetKey && sceneAsset?.sceneAssetKey !== segment.sceneAssetKey) issues.push(`${segment.segmentKey} scene asset key mismatch`);
  if (!segment.sceneAssetKey && sceneAsset) issues.push(`${segment.segmentKey} includes an unused scene asset reference`);
  if (!segment.sceneAssetKey && segment.sceneViewKey !== 'text-only') issues.push(`${segment.segmentKey} without a scene asset must use text-only scene guidance`);
  const segmentSceneKeys = segment.sceneKeys ?? [segment.sceneKey];
  if (sceneAsset?.sourceSceneKeys?.length && !sceneAsset.sourceSceneKeys.some((key) => segmentSceneKeys.includes(key))) issues.push(`${segment.segmentKey} scene asset does not cover ${segmentSceneKeys.join(',')}`);
  const allowedCharacters = new Set(allAssets.filter((asset) => asset.assetKind === 'character').map((asset) => asset.characterName).filter(nonEmpty));
  if (!Array.isArray(segment.characters) || new Set(segment.characters).size !== segment.characters.length || segment.characters.some((name) => !nonEmpty(name))) issues.push(`${segment.segmentKey} has invalid characters`);
  for (const name of segment.characters) if (allowedCharacters.has(name) && !present.some((asset) => asset.assetKind === 'character' && asset.characterName === name)) issues.push(`${segment.segmentKey} lacks ${name} reference`);
  if (present.some((asset) => asset.assetKind === 'character' && !segment.characters.includes(asset.characterName ?? ''))) issues.push(`${segment.segmentKey} includes absent character reference`);
  const props = present.filter((asset) => asset.assetKind === 'prop');
  if (segment.propStateKey === 'none' && props.length > 0) issues.push(`${segment.segmentKey} must not reference prop`);
  if (segment.propStateKey === 'dormant' && !props.some((asset) => asset.stateKey === 'dormant')) issues.push(`${segment.segmentKey} needs dormant prop`);
  if ((segment.propStateKey === 'activated' || segment.propStateKey === 'destroyed') && !props.some((asset) => asset.stateKey === 'activated')) issues.push(`${segment.segmentKey} needs activated prop`);
}

function resolveReferenceAssetIds(
  segment: StoryboardSemanticSegmentDraft | StoryboardSegmentDraft,
  assets: StoryboardAssetReference[]
): string[] {
  const resolved: string[] = [];
  for (const characterName of segment.characters ?? []) {
    const candidates = assets.filter((asset) => asset.assetKind === 'character' && asset.characterName === characterName);
    const mainAsset = candidates.find((asset) => asset.label.includes('主资产')) ?? candidates[0];
    if (mainAsset) resolved.push(mainAsset.assetId);
  }
  const sceneAsset = assets.find((asset) => asset.assetKind === 'scene' && (!segment.sceneAssetKey || asset.sceneAssetKey === segment.sceneAssetKey) && asset.viewKey === segment.sceneViewKey)
    ?? assets.find((asset) => asset.assetKind === 'scene' && asset.sceneAssetKey === segment.sceneAssetKey)
    ?? assets.find((asset) => asset.assetKind === 'scene' && asset.viewKey === segment.sceneViewKey);
  if (sceneAsset) resolved.push(sceneAsset.assetId);
  if (segment.propStateKey !== 'none') {
    const stateKey = segment.propStateKey === 'dormant' ? 'dormant' : 'activated';
    const propAsset = assets.find((asset) => asset.assetKind === 'prop' && asset.stateKey === stateKey);
    if (propAsset) resolved.push(propAsset.assetId);
  }
  return [...new Set(resolved)];
}

function splitAction(value: string): string[] {
  return value.match(/[^。！？]+[。！？]?/gu)?.map((item) => item.trim()).filter(Boolean) ?? [];
}

function storyboardTextContainsDialogue(storyboardText: unknown, dialogue: string): boolean {
  if (typeof storyboardText !== 'string') return false;
  if (storyboardText.includes(dialogue)) return true;
  const target = normalizeDialogue(dialogue);
  if (target.length < 4) return false;
  const fragments = [...storyboardText.matchAll(/[“"‘']([^”"’']+)[”"’']/gu)].map((match) => match[1]);
  for (let start = 0; start < fragments.length; start += 1) {
    let combined = '';
    for (let end = start; end < fragments.length; end += 1) {
      combined += normalizeDialogue(fragments[end]);
      if (combined === target) return true;
      if (!target.startsWith(combined)) break;
    }
  }
  return normalizeDialogue(storyboardText).includes(target);
}

function normalizeDialogue(value: string): string {
  return value.normalize('NFKC').replace(/[\s，。！？、；：,.!?;:“”‘’"'…]+/gu, '');
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function allocateSceneGroups(scenes: Array<{ sceneKey: string; durationSec: number }>, slotCount: number): string[][] {
  if (scenes.length === 0 || slotCount === 0) return [];
  if (slotCount < scenes.length) {
    const groups: string[][] = [];
    let cursor = 0;
    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const remainingSlots = slotCount - slotIndex;
      if (remainingSlots === 1) {
        groups.push(scenes.slice(cursor).map((scene) => scene.sceneKey));
        break;
      }
      const remainingScenes = scenes.slice(cursor);
      const remainingDuration = remainingScenes.reduce((sum, scene) => sum + scene.durationSec, 0);
      const targetDuration = remainingDuration / remainingSlots;
      const maxGroupSize = remainingScenes.length - (remainingSlots - 1);
      let groupSize = 1;
      let groupDuration = remainingScenes[0]?.durationSec ?? 0;
      while (groupSize < maxGroupSize) {
        const nextDuration = groupDuration + (remainingScenes[groupSize]?.durationSec ?? 0);
        if (Math.abs(nextDuration - targetDuration) >= Math.abs(groupDuration - targetDuration)) break;
        groupDuration = nextDuration;
        groupSize += 1;
      }
      groups.push(remainingScenes.slice(0, groupSize).map((scene) => scene.sceneKey));
      cursor += groupSize;
    }
    return groups;
  }
  const totalDurationSec = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  const quotas = scenes.map((scene) => totalDurationSec > 0 ? scene.durationSec / totalDurationSec * slotCount : slotCount / scenes.length);
  const counts = quotas.map((quota) => Math.max(1, Math.floor(quota)));
  while (counts.reduce((sum, count) => sum + count, 0) < slotCount) {
    let selected = 0;
    for (let index = 1; index < scenes.length; index += 1) if (quotas[index] - counts[index] > quotas[selected] - counts[selected]) selected = index;
    counts[selected] += 1;
  }
  while (counts.reduce((sum, count) => sum + count, 0) > slotCount) {
    let selected = -1;
    for (let index = 0; index < scenes.length; index += 1) {
      if (counts[index] <= 1) continue;
      if (selected < 0 || counts[index] - quotas[index] > counts[selected] - quotas[selected]) selected = index;
    }
    if (selected < 0) break;
    counts[selected] -= 1;
  }
  return scenes.flatMap((scene, index) => Array.from({ length: counts[index] }, () => [scene.sceneKey]));
}

function storyboardPromptOutputSchema(input: StoryboardPromptGenerationInput): Record<string, unknown> {
  const segmentCount = buildStoryboardSegmentPlan(input.script, input.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC).length;
  return {
    type: 'object', additionalProperties: false,
    properties: {
      segments: {
        type: 'array', minItems: segmentCount, maxItems: segmentCount,
        items: storyboardSegmentOutputSchema(input)
      }
    },
    required: ['segments']
  };
}

function storyboardSegmentOutputSchema(input: StoryboardPromptGenerationInput): Record<string, unknown> {
  const characterNames = storyboardCharacterNames(input);
  const sceneAssets = input.assets.filter((asset) => asset.assetKind === 'scene');
  const sceneAssetKeys = uniqueStrings(sceneAssets.map((asset) => asset.sceneAssetKey).filter(nonEmpty));
  const sceneViewKeys = uniqueStrings(sceneAssets.map((asset) => asset.viewKey).filter(nonEmpty));
  const approvedPropStates = uniqueStrings(input.assets.filter((asset) => asset.assetKind === 'prop').map((asset) => asset.stateKey).filter(nonEmpty));
  const propStateKeys = ['none', ...approvedPropStates, ...(approvedPropStates.includes('activated') ? ['destroyed'] : [])];
  return {
    type: 'object', additionalProperties: false,
    properties: {
      segmentKey: { type: 'string', pattern: '^SEG[0-9]{3}$' }, sceneKey: { type: 'string', enum: input.script.scenes.map((scene) => scene.sceneKey) }, order: { type: 'integer', minimum: 1 }, title: { type: 'string' }, durationSec: { type: 'integer', minimum: 1, maximum: 15 },
      characters: { type: 'array', items: characterNames.length ? { type: 'string', enum: characterNames } : { type: 'string' }, uniqueItems: true }, sceneAssetKey: { type: 'string', enum: uniqueStrings(['none', ...sceneAssetKeys]) }, sceneViewKey: { type: 'string', enum: uniqueStrings(['text-only', ...sceneViewKeys]) }, propStateKey: { type: 'string', enum: uniqueStrings(propStateKeys) },
      actionEvidenceIds: { type: 'array', items: { type: 'string' } }, dialogueEvidenceIds: { type: 'array', items: { type: 'string' } }, soundCueIds: { type: 'array', items: { type: 'string' } },
      storyboardText: { type: 'string' }, transition: { type: 'string', enum: ['cut', 'continuous', 'fade_to_black'] }
    },
    required: ['segmentKey', 'sceneKey', 'order', 'title', 'durationSec', 'characters', 'sceneAssetKey', 'sceneViewKey', 'propStateKey', 'actionEvidenceIds', 'dialogueEvidenceIds', 'soundCueIds', 'storyboardText', 'transition']
  };
}

function storyboardCharacterNames(input: StoryboardPromptGenerationInput): string[] {
  const assetNames = input.assets.filter((asset) => asset.assetKind === 'character').map((asset) => asset.characterName).filter(nonEmpty);
  const scriptSpeakerNames = input.script.scenes.flatMap((scene) => scene.dialogue
    .filter((line) => line.kind !== 'voiceover')
    .map((line) => line.speakerName)
    .filter(nonEmpty));
  return uniqueStrings([...assetNames, ...scriptSpeakerNames]);
}
