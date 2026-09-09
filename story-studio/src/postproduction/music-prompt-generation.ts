import type { AgentProvider, AgentRequest } from '../providers/contracts.js';
import { partitionAgentDraftValidationIssues } from '../validation/agent-draft-validation.ts';

export interface MusicPromptSegmentInput {
  segmentKey: string;
  title: string;
  durationSec: number;
  storyboardText: string;
  transition: string;
}

export interface MusicPromptGenerationInput {
  projectTitle: string;
  logline: string;
  targetDurationSec: number;
  audioMode: 'native_with_music' | 'music_only';
  subtitles: 'none' | 'burned';
  segments: MusicPromptSegmentInput[];
}

export interface MusicCue {
  segmentKey: string;
  startSec: number;
  endSec: number;
  musicalFunction: string;
  energy: 'low' | 'medium' | 'high';
  instrumentation: string;
  mixNote: string;
}

export interface MusicPromptPlan {
  title: string;
  creativeDirection: string;
  minimaxPrompt: string;
  instrumental: true;
  targetDurationSec: number;
  cues: MusicCue[];
  mixGuidance: string[];
}

export interface MusicPromptRepairInput {
  draft: unknown;
  validationIssues: string[];
}

export class MusicPromptValidationError extends Error {
  readonly issues: string[];
  readonly draft?: unknown;

  constructor(issues: string[], draft?: unknown) {
    super(`Invalid music prompt plan: ${issues.join('; ')}`);
    this.name = 'MusicPromptValidationError';
    this.issues = issues;
    this.draft = draft;
  }
}

export async function generateMusicPromptPlan(
  provider: AgentProvider,
  input: MusicPromptGenerationInput,
  options: { maxOutputTokens?: number } = {}
): Promise<MusicPromptPlan> {
  const request = buildMusicPromptRequest(input, options);
  const result = await provider.generate<MusicPromptPlan>(request);
  return validateMusicPromptPlan(result.output, input);
}

export function buildMusicPromptRequest(
  input: MusicPromptGenerationInput,
  options: { maxOutputTokens?: number } = {}
): AgentRequest {
  validateMusicPromptInput(input);
  const timeline = buildMusicTimeline(input.segments, input.targetDurationSec);
  return {
    operation: 'design-rough-cut-background-score',
    schemaName: 'music_prompt_plan',
    maxOutputTokens: options.maxOutputTokens,
    instructions: [
      '你是PRISM AutoDrama的电影配乐导演。根据已经确认的粗剪与分段内容，设计一条连续的背景配乐方案，并写出可直接提交给ACE-Step 1.5的中文提示词。',
      '这一步只写配乐方案和提示词，不生成音乐，不改写剧情，不增加对白、旁白、歌词或新的同步音效。',
      'instrumental必须为true。兼容字段minimaxPrompt写成40至800字符的简洁中文器乐Caption，不复制逐SEG秒级时间线。',
      'minimaxPrompt首句必须明确“纯器乐电影配乐”，并立即指定哪些乐器承担全部旋律、主题、节奏与情绪表达；后文只写乐器、演奏方式、节奏、音色、能量、空间和连续情绪弧线。',
      '采用单一器乐主题连续发展、变形和收束的电影配乐结构；不要把六个SEG改写成流行音乐式段落，也不要在minimaxPrompt中加入逐秒卡点。',
      'minimaxPrompt中不得出现人声、歌词、吟唱、哼唱、歌唱、演唱、合唱、说唱、咏叹、歌手、歌曲、嗓音、口哨、对白、旁白、vocal、lyrics、sing等概念，即使是否定句也不允许；这些词可能被音乐模型当成生成目标。所有混音让位说明只写入mixGuidance，不写进minimaxPrompt。',
      '如果audioMode为native_with_music，配乐必须为H3原声和对白让位，避免持续占据人声主要频段，并在重要动作声、对白和安静停顿处降低密度。',
      '如果audioMode为music_only，可以承担更多叙事，但仍然保持纯音乐和克制的短片结构。',
      'cues必须逐项对应输入timeline，segmentKey、startSec、endSec和顺序原样复制，不得增删、合并或改写时间边界。',
      'ACE-Step只负责生成音乐主体，系统会按约1.25倍时长生成并在本机裁切；精确卡点、音量包络、淡入淡出和原声混音仍由本机最终合成完成，不要假装模型能逐帧命中卡点。',
      'creativeDirection概括全片音乐语言和情绪弧线；每个cue只写该段音乐功能、能量、主要配器和混音提醒，不复述整段剧情。',
      'mixGuidance给出2至6条可由本机合成执行的具体建议。只输出结构化结果，不解释工作过程。'
    ].join('\n'),
    input: {
      projectTitle: input.projectTitle,
      logline: input.logline,
      targetDurationSec: roundTime(input.targetDurationSec),
      audioMode: input.audioMode,
      subtitles: input.subtitles,
      timeline,
    },
    outputSchema: musicPromptOutputSchema(input),
  };
}

export function buildMusicPromptRepairRequest(
  input: MusicPromptGenerationInput,
  repair: MusicPromptRepairInput,
  options: { maxOutputTokens?: number } = {}
): AgentRequest {
  const base = buildMusicPromptRequest(input, options);
  return {
    ...base,
    operation: 'repair-rough-cut-background-score',
    schemaName: 'music_prompt_plan_repair_v1',
    instructions: [
      '这是当前配乐草稿的唯一一次自动校正。读取repairContext中的原草稿和未通过项，只修正这些问题，保留已经正确的音乐方向、配器、情绪弧线、cue内容与混音建议。',
      '如果未通过项涉及旋律归属，请在minimaxPrompt首句明确写出具体乐器，并说明这些乐器完整承担旋律、主题、节奏与情绪表达；不要只写抽象氛围。',
      '如果未通过项涉及器乐前提或人声概念，使用纯正向器乐表达，不写任何人声、歌词、歌唱、对白或旁白相关词语，包括否定句。',
      'timeline中的segmentKey、startSec、endSec和顺序是已确认事实，原样复制；不得改写剧情或增加声音事件。',
      '只返回修正后的完整JSON，不解释修改过程，不输出诊断、道歉或校验字段。',
      base.instructions,
    ].join('\n'),
    input: {
      ...(base.input as Record<string, unknown>),
      repairContext: {
        previousDraft: repair.draft,
        validationIssues: [...new Set(repair.validationIssues.map((item) => String(item)))],
      },
    },
  };
}

export function hasCompleteInstrumentalMusicAssignment(prompt: string): boolean {
  const instrument = /(?:钢琴|弦乐|小提琴|中提琴|大提琴|低音提琴|提琴|木管|铜管|长笛|短笛|单簧管|双簧管|巴松|圆号|小号|长号|大号|打击乐|定音鼓|鼓组|鼓|合成器|电子脉冲|低频脉冲|古筝|琵琶|二胡|笛子|竹笛|箫|扬琴|马头琴|手碟|竖琴|吉他|贝斯|钟琴|管风琴)/u;
  const role = /(?:旋律|主旋律|主题|音乐|节奏|情绪表达|情绪推进)/u;
  const ownership = /(?:承担|负责|主导|承载|作为|构成|完成)/u;
  if (!instrument.test(prompt) || !role.test(prompt) || !ownership.test(prompt)) return false;
  return /(?:全部|完整|全程|核心|主体|主要)/u.test(prompt)
    || /主旋律\s*由/u.test(prompt)
    || /以.{0,40}(?:作为|构成)(?:全片)?(?:旋律|主旋律|主题|音乐)(?:核心|主体)/u.test(prompt);
}

export function validateMusicPromptPlan(output: unknown, input: MusicPromptGenerationInput): MusicPromptPlan {
  validateMusicPromptInput(input);
  const { value, issues } = inspectMusicPromptPlan(output, input);
  const report = partitionAgentDraftValidationIssues('music-prompt', issues);
  if (report.blockingIssues.length) throw new MusicPromptValidationError(report.blockingIssues, output);
  return value as MusicPromptPlan;
}

export function collectMusicPromptValidationWarnings(output: unknown, input: MusicPromptGenerationInput): string[] {
  validateMusicPromptInput(input);
  const { issues } = inspectMusicPromptPlan(output, input);
  return partitionAgentDraftValidationIssues('music-prompt', issues).warnings;
}

function inspectMusicPromptPlan(output: unknown, input: MusicPromptGenerationInput): { value: Partial<MusicPromptPlan> | null; issues: string[] } {
  const value = output as Partial<MusicPromptPlan> | null;
  const issues: string[] = [];
  const timeline = buildMusicTimeline(input.segments, input.targetDurationSec);
  if (!value || typeof value !== 'object') return { value: null, issues: ['output must be an object'] };
  if (!nonEmpty(value.title)) issues.push('title is required');
  if (!nonEmpty(value.creativeDirection)) issues.push('creativeDirection is required');
  if (!nonEmpty(value.minimaxPrompt)) issues.push('minimaxPrompt is required');
  else if (value.minimaxPrompt.length < 40 || value.minimaxPrompt.length > 800) issues.push('minimaxPrompt must contain 40 to 800 characters');
  else {
    if (!/纯器乐电影配乐/u.test(value.minimaxPrompt)) issues.push('minimaxPrompt must begin from an explicit instrumental film-score premise');
    if (!hasCompleteInstrumentalMusicAssignment(value.minimaxPrompt)) issues.push('minimaxPrompt must assign the complete melodic role to instruments');
    if (/(?:人声|歌词|吟唱|哼唱|歌唱|演唱|合唱|说唱|咏叹|歌手|歌曲|嗓音|口哨|对白|旁白|vocal|lyrics|sing)/iu.test(value.minimaxPrompt)) issues.push('minimaxPrompt must use positive instrumental-only language without vocal concepts');
  }
  if (value.instrumental !== true) issues.push('instrumental must be true');
  if (!sameTime(value.targetDurationSec, input.targetDurationSec)) issues.push('targetDurationSec must match the approved rough cut');
  if (!Array.isArray(value.cues) || value.cues.length !== timeline.length) {
    issues.push('cues must cover every segment exactly once');
  } else {
    value.cues.forEach((cue, index) => {
      const expected = timeline[index];
      if (!cue || typeof cue !== 'object') { issues.push(`cue ${index + 1} is invalid`); return; }
      if (cue.segmentKey !== expected.segmentKey) issues.push(`cue ${index + 1} segmentKey must remain ${expected.segmentKey}`);
      if (!sameTime(cue.startSec, expected.startSec) || !sameTime(cue.endSec, expected.endSec)) issues.push(`${expected.segmentKey} time boundary changed`);
      if (!nonEmpty(cue.musicalFunction) || !nonEmpty(cue.instrumentation) || !nonEmpty(cue.mixNote)) issues.push(`${expected.segmentKey} cue content is incomplete`);
      if (!['low', 'medium', 'high'].includes(String(cue.energy))) issues.push(`${expected.segmentKey} energy is invalid`);
    });
  }
  if (!Array.isArray(value.mixGuidance) || value.mixGuidance.length < 2 || value.mixGuidance.length > 6 || value.mixGuidance.some((item) => !nonEmpty(item))) issues.push('mixGuidance must contain 2 to 6 concrete items');
  return { value, issues };
}

function validateMusicPromptInput(input: MusicPromptGenerationInput): void {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') throw new MusicPromptValidationError(['input must be an object']);
  if (!nonEmpty(input.projectTitle)) issues.push('projectTitle is required');
  if (!nonEmpty(input.logline)) issues.push('logline is required');
  if (!Number.isFinite(input.targetDurationSec) || input.targetDurationSec <= 0) issues.push('targetDurationSec must be positive');
  if (!['native_with_music', 'music_only'].includes(input.audioMode)) issues.push('audioMode must include music');
  if (!['none', 'burned'].includes(input.subtitles)) issues.push('subtitles must be decided');
  if (!Array.isArray(input.segments) || input.segments.length === 0) issues.push('segments are required');
  else {
    const keys = new Set<string>();
    input.segments.forEach((segment, index) => {
      if (!/^SEG\d{3}$/u.test(segment?.segmentKey ?? '') || keys.has(segment.segmentKey)) issues.push(`segment ${index + 1} requires a unique SEG key`);
      keys.add(segment?.segmentKey ?? '');
      if (!nonEmpty(segment?.title) || !nonEmpty(segment?.storyboardText)) issues.push(`segment ${index + 1} content is incomplete`);
      if (!Number.isFinite(segment?.durationSec) || segment.durationSec <= 0) issues.push(`segment ${index + 1} duration is invalid`);
    });
  }
  if (issues.length) throw new MusicPromptValidationError(issues);
}

function buildMusicTimeline(segments: MusicPromptSegmentInput[], targetDurationSec: number) {
  const plannedDuration = segments.reduce((total, segment) => total + segment.durationSec, 0);
  let cursor = 0;
  return segments.map((segment, index) => {
    const startSec = roundTime(cursor);
    cursor = index === segments.length - 1 ? targetDurationSec : cursor + targetDurationSec * segment.durationSec / plannedDuration;
    return {
      segmentKey: segment.segmentKey,
      title: segment.title,
      startSec,
      endSec: roundTime(cursor),
      storyboardText: segment.storyboardText,
      transition: segment.transition,
    };
  });
}

function musicPromptOutputSchema(input: MusicPromptGenerationInput): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' },
      creativeDirection: { type: 'string' },
      minimaxPrompt: { type: 'string' },
      instrumental: { type: 'boolean', const: true },
      targetDurationSec: { type: 'number', const: roundTime(input.targetDurationSec) },
      cues: {
        type: 'array', minItems: input.segments.length, maxItems: input.segments.length,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            segmentKey: { type: 'string', enum: input.segments.map((segment) => segment.segmentKey) },
            startSec: { type: 'number' }, endSec: { type: 'number' }, musicalFunction: { type: 'string' },
            energy: { type: 'string', enum: ['low', 'medium', 'high'] }, instrumentation: { type: 'string' }, mixNote: { type: 'string' },
          },
          required: ['segmentKey', 'startSec', 'endSec', 'musicalFunction', 'energy', 'instrumentation', 'mixNote'],
        },
      },
      mixGuidance: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'creativeDirection', 'minimaxPrompt', 'instrumental', 'targetDurationSec', 'cues', 'mixGuidance'],
  };
}

function sameTime(left: unknown, right: unknown): boolean {
  return Number.isFinite(Number(left)) && Math.abs(Number(left) - Number(right)) <= 0.011;
}

function roundTime(value: number): number {
  return Number(value.toFixed(3));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
