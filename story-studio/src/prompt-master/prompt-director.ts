import type { AgentProvider } from '../providers/contracts.js';
import { loadPromptWritingStandard } from '../free-canvas/prompt-optimization.ts';

export type PromptDirectorFormat = 'five-section-zh' | 'h3-en';
export type PromptDirectorMediaType = 'text' | 'image' | 'video' | 'music';
export type PromptDirectorTextTarget = 'synopsis' | 'script' | 'storyboard';

export type PromptDirectorReference = {
  title: string;
  content: string;
};

export type PromptDirectorTurn = {
  role: 'user' | 'agent';
  content: string;
};

export type PromptDirectorInput = {
  mediaType?: PromptDirectorMediaType;
  textTarget?: PromptDirectorTextTarget;
  format: PromptDirectorFormat;
  idea?: string;
  currentPrompt?: string;
  instruction?: string;
  durationSec?: number;
  aspectRatio?: string;
  references?: PromptDirectorReference[];
  conversation?: PromptDirectorTurn[];
};

export type PromptDirectorResult = {
  prompt: string;
  replyZh: string;
};

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'replyZh'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 12_000 },
    replyZh: { type: 'string', minLength: 1, maxLength: 800 },
  },
} as const;

const VIDEO_FIVE_SECTION_HEADINGS = [
  '基础设定',
  '声音总则',
  '氛围、画质与摄影风格',
  '画面内容与镜头执行',
  '负面词',
] as const;

const IMAGE_FIVE_SECTION_HEADINGS = [
  '基础设定',
  '氛围、画质与摄影风格',
  '画面内容与布局',
  '摄影机与成像',
  '负面词',
] as const;

const TEXT_FIVE_SECTION_HEADINGS = [
  '角色定位',
  '任务目标',
  '已知信息',
  '执行要求',
  '输出格式',
] as const;

const MUSIC_FIVE_SECTION_HEADINGS = [
  '基础设定',
  '风格与情绪',
  '乐器与声音设计',
  '结构与时间线',
  '负面词',
] as const;

function boundedText(value: unknown, limit: number): string {
  return String(value ?? '').trim().slice(0, limit);
}

function normalizedInput(input: PromptDirectorInput) {
  if (!['five-section-zh', 'h3-en'].includes(input?.format)) throw new Error('提示词格式无效。');
  const mediaType: PromptDirectorMediaType = ['text', 'image', 'video', 'music'].includes(String(input?.mediaType))
    ? input.mediaType as PromptDirectorMediaType
    : 'video';
  const textTarget: PromptDirectorTextTarget = ['synopsis', 'script', 'storyboard'].includes(String(input?.textTarget))
    ? input.textTarget as PromptDirectorTextTarget
    : 'script';
  if (mediaType !== 'video' && input.format === 'h3-en') throw new Error('H3标准英文格式仅用于视频提示词。');
  const durationSec = Number(input.durationSec);
  const safe = {
    mediaType,
    textTarget,
    format: input.format,
    idea: boundedText(input.idea, 10_000),
    currentPrompt: boundedText(input.currentPrompt, 12_000),
    instruction: boundedText(input.instruction, 4_000),
    durationSec: Number.isFinite(durationSec) && durationSec > 0 && durationSec <= 300 ? durationSec : 5,
    aspectRatio: boundedText(input.aspectRatio, 20) || '16:9',
    references: Array.isArray(input.references) ? input.references.slice(0, 8).map((item) => ({
      title: boundedText(item?.title, 160),
      content: boundedText(item?.content, 4_000),
    })).filter((item) => item.title || item.content) : [],
    conversation: Array.isArray(input.conversation) ? input.conversation.slice(-8).map((item) => ({
      role: item?.role === 'agent' ? 'agent' as const : 'user' as const,
      content: boundedText(item?.content, 2_000),
    })).filter((item) => item.content) : [],
  };
  if (!safe.idea && !safe.currentPrompt) throw new Error('请先提供创意或当前提示词。');
  if (safe.currentPrompt && !safe.instruction) throw new Error('请告诉Agent这次具体想怎么修改。');
  return safe;
}

function validateFiveSectionPrompt(prompt: string, mediaType: PromptDirectorMediaType): void {
  const headings = mediaType === 'text'
    ? TEXT_FIVE_SECTION_HEADINGS
    : mediaType === 'image'
      ? IMAGE_FIVE_SECTION_HEADINGS
      : mediaType === 'music'
        ? MUSIC_FIVE_SECTION_HEADINGS
        : VIDEO_FIVE_SECTION_HEADINGS;
  let previousIndex = -1;
  for (const heading of headings) {
    const index = prompt.indexOf(heading);
    if (index < 0 || index <= previousIndex) throw new Error(`Agent返回的提示词缺少或打乱了“${heading}”。`);
    previousIndex = index;
  }
}

function validateH3EnglishPrompt(prompt: string): void {
  if (!/^Prompt\s*:/iu.test(prompt)) throw new Error('H3英文提示词必须以“Prompt:”开始。');
  if (!/\n\s*Negative prompt\s*:/iu.test(prompt)) throw new Error('H3英文提示词必须以独立的“Negative prompt:”收束。');
  if (/\p{Script=Han}/u.test(prompt)) throw new Error('H3英文提示词仍包含中文，无法作为英文成品交付。');
}

export async function runPromptDirector(provider: AgentProvider, input: PromptDirectorInput): Promise<PromptDirectorResult> {
  const safe = normalizedInput(input);
  const isRevision = Boolean(safe.currentPrompt);
  const sharedStandard = safe.format === 'five-section-zh' && (safe.mediaType === 'image' || safe.mediaType === 'video') ? loadPromptWritingStandard() : '';
  const textTargetInstruction = safe.textTarget === 'synopsis'
    ? '当前文字目标是故事梗概。提示词必须要求目标模型明确核心人物、世界与时间、起因、主要冲突、关键转折、情绪走向和结局，不写镜头语言，不扩写成完整剧本。'
    : safe.textTarget === 'storyboard'
      ? '当前文字目标是分镜脚本。提示词必须要求目标模型按剧情顺序输出稳定镜头编号、建议时长、景别与机位、画面动作、镜头变化、逐字对白和具体声音；保持事件因果与空间连续性，不写静态图片五段式。'
      : '当前文字目标是短剧本。提示词必须要求目标模型按场次输出地点与时间、出场人物、可见动作、表情、对白和事件结果，保持完整因果并达到可继续拆分镜的程度。';
  const formatInstruction = safe.mediaType === 'text'
    ? [
        '成品必须是可直接交给文字模型使用的中文影视创作提示词，并且只使用以下五个分段标题，顺序固定：角色定位；任务目标；已知信息；执行要求；输出格式。',
        textTargetInstruction,
        '角色定位明确专业身份和工作边界；任务目标写清唯一主要成果；已知信息只整理用户给出的事实和参考；执行要求写步骤、判断标准和必须遵守的约束；输出格式明确语言、结构、长度和交付形态。',
        '不要替用户执行任务，不要把示例内容冒充事实，不要输出对提示词的解释，只交付完整提示词。',
      ].join('\n\n')
    : safe.mediaType === 'music'
      ? [
          '成品必须是可直接交给音乐生成模型使用的中文音乐提示词，并且只使用以下五个分段标题，顺序固定：基础设定；风格与情绪；乐器与声音设计；结构与时间线；负面词。',
          '基础设定明确用途、时长、是否有人声和语言；风格与情绪明确流派、速度、调性和情绪弧线；乐器与声音设计明确核心乐器、音色、节奏与混音空间；结构与时间线按宽松时间段写引子、发展、高潮和收束；负面词只保留当前任务最容易失败的5至8项。',
          '歌词仅在用户明确要求歌曲且提供主题或文本方向时编写；不要虚构品牌、版权归属或真实艺人合作。只输出完整音乐提示词。',
        ].join('\n\n')
      : safe.mediaType === 'image'
    ? [
        '成品必须是中文静态图片生产提示词，并且只使用以下五个分段标题，顺序固定：基础设定；氛围、画质与摄影风格；画面内容与布局；摄影机与成像；负面词。',
        '静态图片没有声音总则和执行时间线。画面内容与布局只写最终画面中可见的对象、状态、位置和视觉重点；摄影机与成像只写景别、镜头感、机位、角度、焦点和景深。',
        '遵守下方项目统一提示词规范；只输出本次成品，不解释规范。',
        sharedStandard,
      ].join('\n\n')
    : safe.format === 'five-section-zh'
    ? [
        '成品必须是中文视频生产提示词，并且只使用以下五个分段标题，顺序固定：基础设定；声音总则；氛围、画质与摄影风格；画面内容与镜头执行；负面词。',
        '画面内容与镜头执行使用一条连续时间线。单镜头先写一次镜头基准；多镜头按镜头块写一次镜头设置和一条执行时间线。',
        '遵守下方项目统一提示词规范；只输出本次成品，不解释规范。',
        sharedStandard,
      ].join('\n\n')
    : [
        '成品必须全英文，适用于PRISM H3视频生成。不要使用中文五段式，也不要写Markdown代码块。',
        '严格使用两部分：第一行以“Prompt:”开始；最后另起一段以“Negative prompt:”开始。',
        'Prompt使用自然、明确、可执行的英文。先锁定场景、主体身份和初始状态，再按时间顺序描述动作、因果、可见结果、镜头、光线、材质和声音。',
        '动作密集时使用宽松时间段，不使用逐帧命令。外力动作写完整物理链。没有明确要求时保持no music, no dialogue, no narration，只保留环境声与同步拟音。',
        'Negative prompt只保留5至8个当前任务最高风险失败项。人物名和专有名词也使用英文或拼音，不得保留汉字。',
      ].join('\n');

  const result = await provider.generate<PromptDirectorResult>({
    operation: isRevision ? 'revise-prompt-director-prompt' : 'create-prompt-director-prompt',
    schemaName: `prompt_director_${safe.mediaType}_${safe.format.replace(/-/gu, '_')}_${isRevision ? 'revision' : 'creation'}_v1`,
    maxOutputTokens: 12_000,
    instructions: [
      `你是PRISM提示词导演。你的职责是根据用户创意写出可直接使用的${safe.mediaType === 'text' ? '文字任务' : safe.mediaType === 'image' ? '图片生成' : safe.mediaType === 'music' ? '音乐生成' : '视频生成'}提示词，并按用户后续意见修改。`,
      formatInstruction,
      isRevision
        ? '这是修改任务。保留当前提示词中未被用户点名修改的剧情、语义、角色身份、因果、空间关系和已正确控制的部分；只改变用户明确提出的内容。返回完整替换版本，禁止返回补丁、差异说明或依赖历史的措辞。'
        : safe.mediaType === 'text'
          ? '这是首次创作任务。把用户目标整理成可执行的文字模型任务说明，明确输入、步骤、约束和输出，不代替目标模型完成最终内容。'
          : safe.mediaType === 'music'
            ? '这是首次创作任务。补齐音乐用途、风格、情绪、速度、乐器、音色、结构和混音控制，但不要虚构版权、艺人或用户没有提供的歌词事实。'
            : safe.mediaType === 'image'
          ? '这是首次创作任务。补齐静态画面所需的主体身份、构图、空间关系、光线、材质和成像控制，但不要虚构品牌、事实卖点、动作过程或用户没有提供的剧情结局。'
          : '这是首次创作任务。补齐生产所需的镜头、动作、时序、声音和可见结果，但不要虚构品牌、事实卖点、逐字对白或用户没有提供的剧情结局。',
      'replyZh用一句简短中文说明本次成品落实了什么，不能把修改历史写进prompt。',
      '只返回结构化字段prompt和replyZh。',
    ].join('\n\n'),
    input: safe,
    outputSchema,
  });
  const prompt = boundedText(result.output?.prompt, 12_000);
  const replyZh = boundedText(result.output?.replyZh, 800);
  if (!prompt || !replyZh) throw new Error('提示词Agent没有返回完整结果。');
  if (safe.format === 'five-section-zh') validateFiveSectionPrompt(prompt, safe.mediaType);
  else validateH3EnglishPrompt(prompt);
  return { prompt, replyZh };
}
