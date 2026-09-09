import type { IdeaScript } from '../ideas/idea-agent.js';
import type { AgentProvider } from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';

export type SeriesEpisodeScriptDraft = Pick<IdeaScript, 'title' | 'logline' | 'scenes' | 'endingHook'> & {
  episodeNumber: number;
};

export interface SeriesEpisodeScriptInput {
  seriesScript: IdeaScript;
  episodeNumber: number;
  priorEpisodeScript?: IdeaScript | null;
  sourceText?: string;
}

export async function generateSeriesEpisodeScript(
  provider: AgentProvider,
  input: SeriesEpisodeScriptInput,
): Promise<IdeaScript> {
  validateInput(input);
  const seriesScript = input.seriesScript;
  const targetPlan = seriesScript.seriesPlan!.find((item) => item.episodeNumber === input.episodeNumber)!;
  const priorPlan = seriesScript.seriesPlan!.find((item) => item.episodeNumber === input.episodeNumber - 1) ?? null;
  const nextPlan = seriesScript.seriesPlan!.find((item) => item.episodeNumber === input.episodeNumber + 1) ?? null;

  const result = await provider.generate<SeriesEpisodeScriptDraft>({
    operation: 'generate-series-episode-script',
    schemaName: 'series_episode_script_v1',
    maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft,
    instructions: [
      '你是PRISM AutoDrama的分集编剧。根据已经确认的全剧规划，只创作指定一集的完整正式剧本。',
      '全剧规划是边界，不是当前集剧本。当前集只展开targetEpisode；不得提前消费后续集的关键事件、反转或结尾钩子。',
      '保持全剧人物身份、人物目标、世界规则、类型、画幅、语言和主情绪一致。可让本集需要的角色出场，但不得为了复述全剧规划而强行让其他角色出现。',
      '若提供上一集正式剧本，只把它作为已发生事实与开场连续性的依据；不得改写上一集。',
      'sourceText是用户原始素材与创作要求。遵守其中的声音要求、动作归属、道具去向和先后顺序；原文的具体事实优先于规划的概括。原文要求无对白或无旁白时，不得添加相应dialogue或os。',
      '场景blocks必须按照实际发生顺序交织动作、对白、内心OS、音效和转场。dialogue用于现场可听见并需要口型的台词；os只用于内心或画外音。',
      '每场给出可拍摄的行动、明确因果、与单集时长匹配的节奏，以及承接全剧规划的本集结尾钩子。',
      '只返回指定集的结构化剧本，不重复输出全剧规划，不解释创作过程。',
    ].join('\n'),
    input: {
      sourceText: input.sourceText ?? '',
      series: {
        title: seriesScript.title,
        logline: seriesScript.logline,
        genre: seriesScript.genre,
        durationSec: seriesScript.durationSec,
        ratio: seriesScript.ratio,
        language: seriesScript.language,
        emotion: seriesScript.emotion,
        plannedEpisodeCount: seriesScript.plannedEpisodeCount,
        characters: seriesScript.characters,
      },
      targetEpisode: targetPlan,
      priorEpisodePlan: priorPlan,
      nextEpisodeBoundary: nextPlan,
      priorEpisodeScript: input.priorEpisodeScript ? {
        episodeNumber: input.priorEpisodeScript.episodeNumber,
        title: input.priorEpisodeScript.title,
        scenes: input.priorEpisodeScript.scenes,
        endingHook: input.priorEpisodeScript.endingHook,
      } : null,
    },
    outputSchema: { ...seriesEpisodeScriptSchema, properties: { ...seriesEpisodeScriptSchema.properties, episodeNumber: { type: 'integer', enum: [input.episodeNumber] } } },
  });

  const draft = result.output;
  if (!draft || draft.episodeNumber !== input.episodeNumber || !draft.title?.trim() || !draft.logline?.trim() || !Array.isArray(draft.scenes) || draft.scenes.length === 0 || !draft.endingHook?.trim()) {
    throw new Error('文字Agent没有返回指定集的完整剧本。');
  }

  return {
    ...seriesScript,
    title: draft.title,
    logline: draft.logline,
    episodeNumber: input.episodeNumber,
    scenes: draft.scenes,
    endingHook: draft.endingHook,
  };
}

const sceneSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' }, location: { type: 'string' }, time: { type: 'string' }, summary: { type: 'string' },
    beats: { type: 'array', minItems: 1, items: { type: 'string' } },
    dialogue: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { speaker: { type: 'string' }, line: { type: 'string' } }, required: ['speaker', 'line'] } },
    blocks: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: {
      type: { type: 'string', enum: ['action', 'dialogue', 'os', 'sfx', 'transition'] }, speaker: { type: 'string' }, delivery: { type: 'string' }, text: { type: 'string' },
    }, required: ['type', 'speaker', 'delivery', 'text'] } },
  },
  required: ['id', 'location', 'time', 'summary', 'beats', 'dialogue', 'blocks'],
} as const;

export const seriesEpisodeScriptSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    episodeNumber: { type: 'integer', minimum: 1, maximum: 30 },
    title: { type: 'string' },
    logline: { type: 'string' },
    scenes: { type: 'array', minItems: 1, maxItems: 12, items: sceneSchema },
    endingHook: { type: 'string' },
  },
  required: ['episodeNumber', 'title', 'logline', 'scenes', 'endingHook'],
} as const;

function validateInput(input: SeriesEpisodeScriptInput) {
  const script = input?.seriesScript;
  if (input.sourceText !== undefined && (typeof input.sourceText !== 'string' || input.sourceText.length > 500_000)) throw new Error('分集原始素材无效或超过50万字。');
  if (!script || script.workType !== 'series' || !Array.isArray(script.seriesPlan) || script.seriesPlan.length < 2) throw new Error('全剧规划无效，无法生成分集剧本。');
  if (!Number.isInteger(input.episodeNumber) || input.episodeNumber < 1 || input.episodeNumber > 30) throw new Error('目标集数无效。');
  if (!script.seriesPlan.some((item) => item.episodeNumber === input.episodeNumber)) throw new Error('全剧规划中没有目标集。');
  if (input.priorEpisodeScript && input.priorEpisodeScript.episodeNumber !== input.episodeNumber - 1) throw new Error('上一集剧本与目标集不连续。');
}
