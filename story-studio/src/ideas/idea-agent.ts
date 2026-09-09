import type { AgentGenerationResult, AgentProvider } from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';

export interface IdeaAnswer {
  question: string;
  answer: string;
}

export interface IdeaScript {
  title: string;
  logline: string;
  genre: string;
  durationSec: number;
  ratio: string;
  language: string;
  emotion: string;
  workType?: 'single' | 'series';
  plannedEpisodeCount?: number;
  episodeNumber?: number;
  seriesPlan?: Array<{ episodeNumber: number; title: string; summary: string; hook: string }>;
  characters: Array<{ name: string; role: string; goal: string }>;
  scenes: Array<{
    id: string;
    location: string;
    time: string;
    summary: string;
    beats: string[];
    dialogue: Array<{ speaker: string; line: string }>;
    blocks?: Array<{ type: 'action' | 'dialogue' | 'os' | 'sfx' | 'transition'; speaker: string; delivery: string; text: string }>;
  }>;
  endingHook: string;
}

export interface IdeaAgentTurn {
  status: 'question' | 'script';
  question: string;
  options: Array<{ id: string; label: string; description: string }>;
  script: IdeaScript | null;
}

export interface IdeaProductionBrief {
  workType: 'single' | 'series';
  creativeDirection?: 'story' | 'commercial' | 'product' | 'knowledge' | 'documentary' | 'music_visual';
  durationSec: number;
  episodeCountMode: 'agent' | 'fixed';
  episodeCount: number | null;
  ratio: string;
  language: string;
  emotion: string;
}

export interface IdeaAgentValidationIssue {
  code: string;
  field: string;
  messageZh: string;
  suggestionZh: string;
}

export class IdeaAgentValidationError extends Error {
  readonly code = 'idea_agent_validation_failed';
  readonly issues: IdeaAgentValidationIssue[];
  readonly diagnostics: {
    operation: string;
    targetKeys: string[];
    requestedModel?: string;
    externalTaskId?: string;
    elapsedMs?: number;
    invalidDraft: unknown;
  };

  constructor(issues: IdeaAgentValidationIssue[], invalidDraft: unknown, result?: AgentGenerationResult<IdeaAgentTurn>) {
    super(issues.map((issue) => issue.messageZh).join('；'));
    this.name = 'IdeaAgentValidationError';
    this.issues = issues;
    this.diagnostics = {
      operation: 'develop-original-short-drama',
      targetKeys: ['SCRIPT'],
      ...(result?.model ? { requestedModel: result.model } : {}),
      ...(result?.externalTaskId ? { externalTaskId: result.externalTaskId } : {}),
      ...(Number.isFinite(result?.elapsedMs) ? { elapsedMs: result!.elapsedMs } : {}),
      invalidDraft,
    };
  }
}

export async function runIdeaAgentTurn(
  provider: AgentProvider,
  input: { idea: string; answers: IdeaAnswer[]; forceScript?: boolean; production?: IdeaProductionBrief },
  options: { maxOutputTokens?: number } = {}
): Promise<IdeaAgentTurn> {
  validateInput(input);
  const production = normalizeProduction(input.production);
  const round = input.answers.length;
  const mustWriteScript = Boolean(input.forceScript) || round >= 3;

  const result = await provider.generate<IdeaAgentTurn>({
    operation: 'develop-original-short-drama',
    schemaName: 'idea_agent_turn',
    maxOutputTokens: options.maxOutputTokens ?? (round >= 2 || mustWriteScript ? TEXT_TOKEN_BUDGETS.formalDraft : TEXT_TOKEN_BUDGETS.directionQuestion),
    instructions: [
      '你是PRISM AutoDrama的编剧导演，兼具职业编剧的叙事能力与导演的视听判断。',
      '你的任务是把用户的一句话创意发展成与作品方向一致、可直接制作的中文脚本。',
      '先阅读创意和已有问答，只追问会实质影响最终表达、内容结构或影片形态的信息。',
      '采用先发散、后收敛的工作方式。需要追问时，只提出一个真正影响结果的问题，并给出少量差异明确的推荐方向；能直接完成时不为凑轮次而追问。',
      '当creativeDirection为story时，第一轮只帮助用户选择故事发展方向；选项覆盖不同叙事重心，但必须根据当前创意动态组织。不得追问能力次数、触发条件、具体怪物身份或具体熟人关系等过细设定，也不得把自行发明的具体设定塞进问题。',
      '当creativeDirection为commercial时，不得默认要求剧情；优先确认核心卖点、受众、广告表达结构或片尾落点。只有用户明确选择轻剧情或叙事广告时才建立人物冲突。',
      '当creativeDirection为product时，不得追问故事走向；优先确认需要展示的外观、材质、功能、使用过程、结果与视觉顺序，人物仅在产品使用确有需要时出现。',
      '当creativeDirection为knowledge时，不得默认建立剧情；优先确认核心问题、目标受众、讲解深度、信息顺序、示例或演示方式，以及是否需要口播主体。',
      '当creativeDirection为documentary时，以真实信息边界为最高优先级；优先确认纪录对象、观察视角、时间范围、可用采访或现场材料，不得把推测和虚构包装成事实。',
      '当creativeDirection为music_visual时，以音乐结构和视觉体验为主；优先确认音乐来源、节奏段落、表演或抽象视觉方式、核心意象与视觉弧线，不得默认添加人物冲突。',
      '每个选项只描述方向及其体验，不替用户确定角色姓名、人物关系、规则答案或结局。用户始终可以给出自定义方向。',
      '后续轮次只能基于用户已选方向逐步收敛，不要重复已经回答的内容，不要在一个问题里堆叠多个互不相关的具体问题。',
      '返回question前必须与previousQuestions逐项比较；不得重复、改写复述或换一种说法再次询问任何历史问题。上一轮选中的方向已经是确定信息，下一轮只能追问新的决策维度。',
      '用户要求直接生成或当前信息已经足够时返回script；只有缺少会实质改变结果的信息时才返回question。',
      'production是用户已经确认的正式创作参数，问题和剧本都必须服从其中的作品方向、内容形式、时长、画幅、语言与主情绪或表达气质，不得自行改写。',
      'creativeDirection与workType是两个独立维度。single表示在指定总时长内完成一条独立作品；series表示先建立与所选方向一致的完整系列规划，并只写第1集的正式执行脚本，plannedEpisodeCount记录规划集数，seriesPlan逐集给出主题、内容梗概与结尾收束。',
      '剧情叙事必须形成完整的事件和情绪推进；广告营销、产品展示、知识讲解、纪录纪实、音乐与视觉可以使用非剧情结构，但都必须在时长内形成清晰的开场、展开与收束。',
      '正式剧本采用可直接阅读和表演的场景格式。每场的blocks必须按照实际发生顺序交织动作、对白、内心OS、音效和转场，不能把动作列表与对白列表彼此分离。',
      '现场可听见、需要人物口型的台词一律使用dialogue，包括低声、喘息、咬牙挤出的声音；os只用于内心独白或画外音，delivery必须明确写“内心”或“画外”。每个dialogue或os块写明speaker和delivery；动作块用可见、可拍摄的行为表达。beats和dialogue继续提供给后续结构化提取，但不得与blocks发生事实冲突。',
      'characters只列确实需要身份连续的出镜人物或角色；没有出镜人物时返回空数组。环境、场景、背景、氛围、镜头、画面、产品、品牌、道具、主题或抽象概念都不是人物，不得写入characters。生成脚本时给出与方向和时长匹配的场景密度、可执行内容和明确结尾。',
      '只输出结构化结果，不解释工作过程。'
    ].join('\n'),
    input: {
      idea: input.idea,
      answers: input.answers,
      previousQuestions: input.answers.map((item) => item.question),
      answeredRounds: round,
      maximumRounds: 3,
      canWriteScript: mustWriteScript,
      forceScript: mustWriteScript,
      production
    },
    outputSchema: mustWriteScript ? ideaScriptTurnSchema : ideaAdaptiveTurnSchema
  });

  const normalized = normalizeTurn(result.output, production);
  validateTurn(normalized, mustWriteScript, production, result);
  return normalized;
}

const directionOptionsSchema = {
  type: 'array', minItems: 1, maxItems: 4,
  items: {
    type: 'object', additionalProperties: false,
    properties: { id: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' } },
    required: ['id', 'label', 'description']
  }
} as const;

export const ideaScriptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    logline: { type: 'string' },
    genre: { type: 'string' },
    durationSec: { type: 'integer', minimum: 5, maximum: 600 },
    ratio: { type: 'string' },
    language: { type: 'string' },
    emotion: { type: 'string' },
    workType: { type: 'string', enum: ['single', 'series'] },
    plannedEpisodeCount: { type: 'integer', minimum: 1, maximum: 30 },
    episodeNumber: { type: 'integer', minimum: 1, maximum: 30 },
    seriesPlan: {
      type: 'array', maxItems: 30,
      items: { type: 'object', additionalProperties: false, properties: {
        episodeNumber: { type: 'integer', minimum: 1, maximum: 30 }, title: { type: 'string' }, summary: { type: 'string' }, hook: { type: 'string' }
      }, required: ['episodeNumber', 'title', 'summary', 'hook'] }
    },
    characters: {
      type: 'array', minItems: 0, maxItems: 12,
      items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, role: { type: 'string' }, goal: { type: 'string' } }, required: ['name', 'role', 'goal'] }
    },
    scenes: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, location: { type: 'string' }, time: { type: 'string' }, summary: { type: 'string' },
          beats: { type: 'array', minItems: 1, items: { type: 'string' } },
          dialogue: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { speaker: { type: 'string' }, line: { type: 'string' } }, required: ['speaker', 'line'] } },
          blocks: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: {
            type: { type: 'string', enum: ['action', 'dialogue', 'os', 'sfx', 'transition'] }, speaker: { type: 'string' }, delivery: { type: 'string' }, text: { type: 'string' }
          }, required: ['type', 'speaker', 'delivery', 'text'] } }
        },
        required: ['id', 'location', 'time', 'summary', 'beats', 'dialogue', 'blocks']
      }
    },
    endingHook: { type: 'string' }
  },
  required: ['title', 'logline', 'genre', 'durationSec', 'ratio', 'language', 'emotion', 'workType', 'plannedEpisodeCount', 'episodeNumber', 'seriesPlan', 'characters', 'scenes', 'endingHook']
} as const;

const ideaAdaptiveTurnSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['question', 'script'] },
    question: { type: 'string' },
    options: { type: 'array', maxItems: 4, items: directionOptionsSchema.items },
    script: { anyOf: [{ type: 'null' }, ideaScriptSchema] }
  },
  required: ['status', 'question', 'options', 'script']
} as const;

const ideaScriptTurnSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['script'] },
    question: { type: 'string', maxLength: 0 },
    options: { type: 'array', maxItems: 0, items: directionOptionsSchema.items },
    script: ideaScriptSchema
  },
  required: ['status', 'question', 'options', 'script']
} as const;

function validateInput(input: { idea: string; answers: IdeaAnswer[]; production?: IdeaProductionBrief }) {
  if (!input.idea.trim() || input.idea.length > 20_000) throw new Error('创意内容长度无效。');
  for (const item of input.answers) {
    if (!item.question.trim() || !item.answer.trim() || item.answer.length > 1_000) throw new Error('问答记录无效。');
  }
}

function validateTurn(turn: IdeaAgentTurn, mustWriteScript: boolean, production: IdeaProductionBrief, result?: AgentGenerationResult<IdeaAgentTurn>) {
  const fail = (issue: IdeaAgentValidationIssue): never => { throw new IdeaAgentValidationError([issue], turn, result); };
  if (mustWriteScript && (turn.status !== 'script' || !turn.script)) fail({ code: 'script_missing_after_final_round', field: 'status', messageZh: '编剧导演在追问结束后没有返回完整剧本。', suggestionZh: '保留现有问答，手动重新生成剧本。' });
  if (turn.status === 'question' && (!turn.question.trim() || turn.script !== null || turn.options.length < 1)) fail({ code: 'question_structure_invalid', field: 'question/options', messageZh: '编剧导演返回的追问或选项结构不完整。', suggestionZh: '保留已有回答，重新请求本轮问题。' });
  if (turn.status === 'question' && turn.options.some((option) => !option.id.trim() || !option.label.trim() || !option.description.trim())) fail({ code: 'question_option_incomplete', field: 'options', messageZh: '编剧导演返回了缺少标题或说明的方向选项。', suggestionZh: '保留已有回答，重新请求本轮问题。' });
  if (turn.status === 'question' && new Set(turn.options.map((option) => option.label.trim())).size !== turn.options.length) fail({ code: 'question_option_duplicate', field: 'options', messageZh: '编剧导演返回了重复的方向选项。', suggestionZh: '保留已有回答，重新请求本轮问题。' });
  if (turn.status === 'script' && (!turn.script || turn.question.trim() || turn.options.length !== 0)) fail({ code: 'script_turn_structure_invalid', field: 'script/question/options', messageZh: '编剧导演返回的剧本结果结构不完整。', suggestionZh: '检查创作设定后重新生成剧本。' });
  if (turn.status === 'script' && turn.script) {
    if (turn.script.durationSec !== production.durationSec || turn.script.ratio !== production.ratio || turn.script.language !== production.language || turn.script.emotion !== production.emotion) fail({ code: 'script_locked_metadata_mismatch', field: 'durationSec/ratio/language/emotion', messageZh: '剧本的锁定制作参数与项目设定不一致。', suggestionZh: '检查创作设定；系统只校正制作参数，不改写剧本正文。' });
    if (turn.script.workType && turn.script.workType !== production.workType) fail({ code: 'script_work_type_mismatch', field: 'workType', messageZh: '剧本作品形态与项目设定不一致。', suggestionZh: '检查单条作品或系列作品设定。' });
    if (production.workType === 'series' && production.episodeCountMode === 'fixed' && turn.script.plannedEpisodeCount !== production.episodeCount) fail({ code: 'script_episode_count_mismatch', field: 'plannedEpisodeCount', messageZh: '剧本规划集数与项目设定不一致。', suggestionZh: '检查系列集数设定。' });
  }
}

function normalizeProduction(input?: IdeaProductionBrief): IdeaProductionBrief {
  if (!input) return { workType: 'single', creativeDirection: 'story', durationSec: 60, episodeCountMode: 'agent', episodeCount: null, ratio: '9:16', language: '中文', emotion: '紧张' };
  if (!['single', 'series'].includes(input.workType)) throw new Error('作品形态无效。');
  const creativeDirection = ['story', 'commercial', 'product', 'knowledge', 'documentary', 'music_visual'].includes(input.creativeDirection || '') ? input.creativeDirection! : 'story';
  const minimumDurationSec = input.workType === 'single' && creativeDirection !== 'story' ? 5 : 15;
  if (!Number.isInteger(input.durationSec) || input.durationSec < minimumDurationSec || input.durationSec > 600) throw new Error('影片时长无效。');
  if (!['agent', 'fixed'].includes(input.episodeCountMode)) throw new Error('集数规划方式无效。');
  if (input.workType === 'series' && input.episodeCountMode === 'fixed' && (!Number.isInteger(input.episodeCount) || Number(input.episodeCount) < 2 || Number(input.episodeCount) > 30)) throw new Error('预计集数无效。');
  if (!input.ratio?.trim() || !input.language?.trim() || !input.emotion?.trim()) throw new Error('影片参数不完整。');
  return { ...input, creativeDirection, episodeCount: input.workType === 'series' && input.episodeCountMode === 'fixed' ? Number(input.episodeCount) : null };
}

function normalizeTurn(turn: IdeaAgentTurn, production: IdeaProductionBrief): IdeaAgentTurn {
  if (turn.status === 'script' && turn.script) {
    const seenCharacterNames = new Set<string>();
    const characters = (Array.isArray(turn.script.characters) ? turn.script.characters : []).filter((character) => {
      const name = character?.name?.trim();
      if (!name || seenCharacterNames.has(name)) return false;
      seenCharacterNames.add(name);
      return true;
    });
    return {
      status: 'script',
      question: '',
      options: [],
      script: {
        ...turn.script,
        durationSec: production.durationSec,
        ratio: production.ratio,
        language: production.language,
        emotion: production.emotion,
        workType: production.workType,
        ...(production.workType === 'series' && production.episodeCountMode === 'fixed' ? { plannedEpisodeCount: Number(production.episodeCount) } : {}),
        characters,
      },
    };
  }
  if (turn.status === 'question') {
    const seen = new Set<string>();
    const options = (Array.isArray(turn.options) ? turn.options : []).filter((option) => {
      const label = option?.label?.trim();
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    }).slice(0, 4);
    return { status: 'question', question: turn.question?.trim() ?? '', options, script: null };
  }
  return turn;
}
