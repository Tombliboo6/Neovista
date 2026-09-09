import { referencePurposeLabels, type CanvasReferencePurpose } from "./reference-contract.ts";
import type { AgentProvider } from '../providers/contracts.js';
import { existsSync, readFileSync } from 'node:fs';

export type FreeCanvasPromptKind = 'text' | 'image' | 'video' | 'audio';
export type FreeCanvasTextOutputTarget = 'script' | 'image' | 'video';
export type FreeCanvasPromptReference = {
  kind: FreeCanvasPromptKind | 'director';
  title: string;
  purpose?: CanvasReferencePurpose;
  content?: string;
};

export const freeCanvasPromptOptimizationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['optimizedPrompt'],
  properties: { optimizedPrompt: { type: 'string', minLength: 1, maxLength: 12_000 } },
} as const;

const imagePromptOptimizationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['basicSetting', 'atmosphereQualityPhotography', 'contentLayout', 'cameraImaging', 'negativeTerms'],
  properties: {
    basicSetting: { type: 'string', minLength: 1, maxLength: 4_000 },
    atmosphereQualityPhotography: { type: 'string', minLength: 1, maxLength: 4_000 },
    contentLayout: { type: 'string', minLength: 1, maxLength: 4_000 },
    cameraImaging: { type: 'string', minLength: 1, maxLength: 4_000 },
    negativeTerms: { type: 'string', minLength: 1, maxLength: 2_000 },
  },
} as const;

const videoPromptOptimizationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['basicSetting', 'soundPolicy', 'atmosphereQualityPhotography', 'visualExecution', 'negativeTerms'],
  properties: {
    basicSetting: { type: 'string', minLength: 1, maxLength: 4_000 },
    soundPolicy: { type: 'string', minLength: 1, maxLength: 3_000 },
    atmosphereQualityPhotography: { type: 'string', minLength: 1, maxLength: 4_000 },
    visualExecution: { type: 'string', minLength: 1, maxLength: 6_000 },
    negativeTerms: { type: 'string', minLength: 1, maxLength: 2_000 },
  },
} as const;

const promptWritingStandardUrls = [
  new URL('../../docs/AI_GENERATION_PROMPT_STANDARD.md', import.meta.url),
  new URL('./docs/AI_GENERATION_PROMPT_STANDARD.md', import.meta.url),
];

export function loadPromptWritingStandard(): string {
  const promptWritingStandardUrl = promptWritingStandardUrls.find((candidate) => existsSync(candidate));
  if (!promptWritingStandardUrl) throw new Error('项目内的统一图片与视频提示词规范文件不存在。');
  const source = readFileSync(promptWritingStandardUrl, 'utf8');
  if (!source.includes('## Global AI prompt writing standard') || !source.includes('### Video action, pacing, and revision rules') || !source.includes('### Jimeng video prompt rules')) {
    throw new Error('项目内的统一图片与视频提示词规范不完整。');
  }
  return source.trim();
}

const kindInstructions: Record<FreeCanvasPromptKind, string> = {
  text: '这是文字节点。当前优化目标由用户明确选择，不要自行更换输出类型。',
  image: '这是静态图片生成节点。必须严格按以下中文五段式及顺序输出，标题逐字使用：基础设定；氛围、画质与摄影风格；画面内容与布局；摄影机与成像；负面词。正向段只写期望结果，负面词只保留5—8个最高风险项。',
  video: '这是视频生成节点。必须严格按以下中文五段式及顺序输出，标题逐字使用：基础设定；声音总则；氛围、画质与摄影风格；画面内容与镜头执行；负面词。默认无背景音乐、无对白、无旁白；无语言镜头的音轨使用封闭声音白名单，正向字段不使用引号或可朗读的宣传语，结尾改写成可见物理状态；画面内容与镜头执行使用一条按时间排序的执行线，明确动作主体、因果、起止状态、镜头变化和可见结果。',
  audio: '这是ACE-Step音乐生成节点。保留用户的音乐目标，补齐用途、情绪弧线、速度、乐器、结构、音色与混音；不要凭空添加歌词。',
};

const textTargetInstructions: Record<FreeCanvasTextOutputTarget, string> = {
  script: '把草稿扩写为可直接进入制作的中文脚本。根据内容类型采用合适结构：剧情内容写清场景、人物、动作、对白与因果；广告或产品内容写清镜头顺序、展示主体、卖点、动作、声音与片尾落点，不强行加入剧情。覆盖用户要求的完整时长，并保留原始事实与表达目标。',
  image: kindInstructions.image,
  video: kindInstructions.video,
};

type ReferenceMentionKind = 'image' | 'video' | 'audio';
type ReferenceMention = { kind: ReferenceMentionKind; index: number; token: string };

const referenceMentionLabels: Record<ReferenceMentionKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

function extractReferenceMentions(prompt: string, references: FreeCanvasPromptReference[]): ReferenceMention[] {
  const available = references.reduce<Record<ReferenceMentionKind, number>>((counts, reference) => {
    if (reference.kind === 'image' || reference.kind === 'video' || reference.kind === 'audio') counts[reference.kind] += 1;
    return counts;
  }, { image: 0, video: 0, audio: 0 });
  const kindByLabel = new Map(Object.entries(referenceMentionLabels).map(([kind, label]) => [label, kind as ReferenceMentionKind]));
  const mentions: ReferenceMention[] = [];
  const seen = new Set<string>();
  for (const match of prompt.matchAll(/@(图片|视频|音频)\s*(\d+)/gu)) {
    const kind = kindByLabel.get(match[1]);
    const index = Number(match[2]);
    if (!kind || !Number.isInteger(index) || index < 1 || index > available[kind]) {
      throw new Error(`提示词使用了 @${match[1]}${match[2]}，但当前只有${kind ? available[kind] : 0}项${match[1]}参考。`);
    }
    const token = `@${referenceMentionLabels[kind]}${index}`;
    if (!seen.has(token)) {
      mentions.push({ kind, index, token });
      seen.add(token);
    }
  }
  return mentions;
}

function compileReferenceFields(mentions: ReferenceMention[]): string {
  return (Object.keys(referenceMentionLabels) as ReferenceMentionKind[]).flatMap((kind) => {
    const tokens = mentions.filter((mention) => mention.kind === kind).map((mention) => mention.token);
    return tokens.length ? [`${referenceMentionLabels[kind]}参考：${tokens.join('、')}`] : [];
  }).join('\n');
}

function requiredSection(output: Record<string, unknown>, key: string): string {
  const value = String(output[key] ?? '').trim();
  if (!value) throw new Error('文字Agent返回的生产提示词缺少必要分段，原文已保留。');
  return value;
}

const QUOTATION_MARK_PATTERN = /[“”‘’"']/u;

function sourceRequestsVideoLanguage(prompt: string, references: FreeCanvasPromptReference[]): boolean {
  const source = [prompt, ...references.map((reference) => `${reference.title}\n${reference.content ?? ''}`)].join('\n');
  const explicitSpeech = /(?:需要|加入|保留|包含|使用|配有|安排|出现)[^。；\n]{0,18}(?:对白|台词|旁白|画外音|内心(?:声|独白)|口播|解说|唱歌|歌唱|哼唱)|(?:对白|台词|旁白|画外音|内心(?:声|独白)|口播|解说)\s*[：:]|(?:开口说|说道|说出|喊道|问道|回答|朗读|念出)[^。！？\n]{0,18}[“”‘’"']/u.test(source);
  const explicitOnScreenText = /(?:字幕|标题卡|屏幕文字|画面文字|招牌文字|可见文字)(?:[^。；\n]{0,12})(?:浮现|出现|显示|呈现|写着|内容为|[：:])/u.test(source);
  return explicitSpeech || explicitOnScreenText;
}

export function validateVideoPromptLanguageSurface(prompt: string): void {
  const source = String(prompt || '').trim();
  if (!source || sourceRequestsVideoLanguage(source, [])) return;
  const positiveSurface = source.split(/\n\s*负面词\s*\n/u, 1)[0];
  if (QUOTATION_MARK_PATTERN.test(positiveSurface)) {
    throw new Error('无对白、旁白或画面文字的视频提示词不能包含引号内容；请把宣传语或总结改写为可见物理状态。');
  }
  const soundPolicy = positiveSurface.match(/(?:^|\n)\s*声音总则\s*\n([\s\S]*?)(?=\n\s*氛围、画质与摄影风格\s*\n|$)/u)?.[1]?.trim();
  if (soundPolicy && !/(?:零人声|无人声|无任何人声|无对白[^。；\n]{0,24}无旁白|无旁白[^。；\n]{0,24}无对白)/u.test(soundPolicy)) {
    throw new Error('无语言视频的声音总则必须明确零人声，并只列允许出现的环境声与同步拟音。');
  }
}

function validateOptimizedVideoLanguageSurface(output: Record<string, unknown>, languageRequested: boolean, inheritedAudioAllowed: boolean): void {
  if (languageRequested) return;
  const soundPolicy = requiredSection(output, 'soundPolicy');
  if (!inheritedAudioAllowed && !/(?:零人声|无人声|无任何人声|无对白[^。；\n]{0,24}无旁白|无旁白[^。；\n]{0,24}无对白)/u.test(soundPolicy)) {
    throw new Error('无语言视频的声音总则必须明确零人声，并只列允许出现的环境声与同步拟音；原文已保留。');
  }
  const positiveSurface = ['basicSetting', 'soundPolicy', 'atmosphereQualityPhotography', 'visualExecution']
    .map((key) => requiredSection(output, key))
    .join('\n');
  if (QUOTATION_MARK_PATTERN.test(positiveSurface)) {
    throw new Error('无对白、旁白或画面文字的视频提示词不能包含引号内容；请把宣传语或总结改写为可见物理状态。原文已保留。');
  }
}

function compileOptimizedPrompt(kind: FreeCanvasPromptKind | FreeCanvasTextOutputTarget, output: Record<string, unknown>, mentions: ReferenceMention[]): string {
  const referenceFields = compileReferenceFields(mentions);
  const body = kind === 'image' ? [
    '基础设定', requiredSection(output, 'basicSetting'),
    '氛围、画质与摄影风格', requiredSection(output, 'atmosphereQualityPhotography'),
    '画面内容与布局', requiredSection(output, 'contentLayout'),
    '摄影机与成像', requiredSection(output, 'cameraImaging'),
    '负面词', requiredSection(output, 'negativeTerms'),
  ].join('\n\n') : kind === 'video' ? [
    '基础设定', requiredSection(output, 'basicSetting'),
    '声音总则', requiredSection(output, 'soundPolicy'),
    '氛围、画质与摄影风格', requiredSection(output, 'atmosphereQualityPhotography'),
    '画面内容与镜头执行', requiredSection(output, 'visualExecution'),
    '负面词', requiredSection(output, 'negativeTerms'),
  ].join('\n\n') : requiredSection(output, 'optimizedPrompt');
  return [referenceFields, body].filter(Boolean).join('\n\n');
}

export async function optimizeFreeCanvasPrompt(provider: AgentProvider, input: {
  kind: FreeCanvasPromptKind;
  prompt?: string;
  references?: FreeCanvasPromptReference[];
  audioMode?: 'instrumental' | 'song';
  textTarget?: FreeCanvasTextOutputTarget;
}): Promise<string> {
  if (!Object.hasOwn(kindInstructions, input?.kind)) throw new Error('自由画布提示词类型无效。');
  const textTarget: FreeCanvasTextOutputTarget = input.kind === 'text' && Object.hasOwn(textTargetInstructions, input.textTarget || '') ? input.textTarget! : 'script';
  const outputKind: FreeCanvasPromptKind | FreeCanvasTextOutputTarget = input.kind === 'text' ? textTarget : input.kind;
  const prompt = String(input?.prompt ?? '').trim();
  const references = Array.isArray(input?.references) ? input.references.slice(0, 20).map((reference) => ({
    kind: reference?.kind,
    title: String(reference?.title ?? '').trim().slice(0, 160),
    ...(reference?.purpose && Object.hasOwn(referencePurposeLabels, reference.purpose) ? { purpose: reference.purpose, purposeLabel: referencePurposeLabels[reference.purpose] } : {}),
    content: String(reference?.content ?? '').trim().slice(0, 5_000),
  })).filter((reference) => reference.title || reference.content) : [];
  const sourceLength = prompt.length + references.reduce((total, reference) => total + reference.title.length + reference.content.length, 0);
  if (!sourceLength || sourceLength > 10_000) throw new Error('待优化内容和上游文字参考合计必须为1—10000字。');
  if (input.kind === 'audio' && /@(图片|视频|音频)\s*\d+/u.test(prompt)) throw new Error('ACE-Step音乐节点使用文字与音乐参数生成，请移除提示词中的媒体引用标记。');
  const referenceMentions = extractReferenceMentions(prompt, references);
  const isReferenceEdit = referenceMentions.length > 0 && /(?:替换|换成|改成|改为|移除|去掉|删除|保留|只改|仅改)/u.test(prompt);
  const outputSchema = outputKind === 'image' ? imagePromptOptimizationSchema : outputKind === 'video' ? videoPromptOptimizationSchema : freeCanvasPromptOptimizationSchema;
  const sharedPromptStandard = outputKind === 'image' || outputKind === 'video' ? loadPromptWritingStandard() : '';
  const result = await provider.generate<Record<string, string>>({
    operation: 'optimize-free-canvas-prompt',
    schemaName: `free_canvas_${input.kind}_${outputKind}_prompt_optimization_v3`,
    maxOutputTokens: 12_000,
    instructions: [
      '你是PRISM AutoDrama的制作提示词编辑。把用户草稿优化为可直接生产的中文提示词。',
      input.kind === 'text' ? textTargetInstructions[textTarget] : kindInstructions[input.kind],
      sharedPromptStandard ? `以下内容来自本项目共享Markdown，是当前图片与视频提示词的统一完整规范，必须逐条遵守：\n\n${sharedPromptStandard}` : undefined,
      input.kind === 'audio'
        ? input.audioMode === 'song'
          ? '当前节点类型为歌曲。只优化音乐描述中的曲风、配器、情绪、演唱声线和结构；歌词由独立歌词字段控制，不要在optimizedPrompt中编写或重复歌词。'
          : '当前节点类型为纯音乐。只使用正向器乐描述，明确由乐器承担旋律与情绪表达。'
        : undefined,
      '上游参考只作为当前节点的输入依据；不要把节点名称或JSON结构照抄进成品。身份、品牌、产品型号、事实性卖点、人物关系和逐字对白只能来自草稿或明确参考。',
      referenceMentions.length
        ? `草稿明确调用了${referenceMentions.map((mention) => mention.token).join('、')}。这些引用标记由本地程序原样放在成品开头；结构化字段正文不要改号、替换或重复这些标记，并用“参考素材中的既有状态”表达需要继承的内容。`
        : '草稿没有显式调用参考素材，不要自行添加引用标记。',
      isReferenceEdit
        ? '这是基于已调用参考素材的局部编辑任务。只落实用户明确要求的变化；人物身份、服装、场景、构图、机位、镜头运动、动作节奏、时序、画风和声音等未点名内容均继承参考素材。不要改写为重新创作，不要提供地点、动作或风格备选项。'
        : outputKind === 'image' || outputKind === 'video'
          ? '这是从创意简介生成完整生产提示词的任务。必须把简短草稿发展为具体、可执行的成品，合理补全构图、环境、光线、材质、动作、镜头和声音等制作选择，不得只做同义改写。不要虚构命名品牌、产品型号、未经提供的事实性卖点、角色关系、逐字对白或剧情结局。'
          : '把简短草稿扩写成完整、可执行的目标文本，不得只做同义改写。',
      outputKind === 'video'
        ? '如果草稿给出总时长，执行时间线必须从0秒开始连续覆盖到该总时长；最后一段必须包含明确的可见收束结果。'
        : undefined,
      outputKind === 'image' || outputKind === 'video'
        ? '只填写结构化字段内容，不在字段正文中重复分段标题；最终中文五段式由本地程序固定编排。'
        : '每个控制事实只写一次，删除同义重复。只返回optimizedPrompt，不解释修改过程。',
    ].filter(Boolean).join('\n'),
    input: { kind: input.kind, outputTarget: outputKind, prompt, references, referenceMentions: referenceMentions.map((mention) => mention.token), intentMode: isReferenceEdit ? 'reference_edit' : 'create', promptStandardSource: sharedPromptStandard ? 'docs/AI_GENERATION_PROMPT_STANDARD.md' : undefined },
    outputSchema,
  });
  if (outputKind === 'video') {
    const inheritedAudioAllowed = isReferenceEdit && referenceMentions.some((mention) => mention.kind === 'video' || mention.kind === 'audio');
    validateOptimizedVideoLanguageSurface(result.output || {}, sourceRequestsVideoLanguage(prompt, references), inheritedAudioAllowed);
  }
  const optimized = compileOptimizedPrompt(outputKind, result.output || {}, referenceMentions);
  if (!optimized || optimized.length > (input.kind === 'audio' ? 2_000 : 12_000)) throw new Error('文字Agent没有返回有效的优化提示词。');
  return optimized;
}
