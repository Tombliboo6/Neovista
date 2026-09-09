import type { IdeaProductionBrief, IdeaScript } from '../ideas/idea-agent.js';
import { ideaScriptSchema } from '../ideas/idea-agent.ts';
import { normalizeNovelText } from '../intake/normalize.ts';
import type { AgentProvider } from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';

export interface NovelAdaptationInput {
  novelText: string;
  sourceName: string;
  production: IdeaProductionBrief;
}

export class NovelAdaptationValidationError extends Error {
  readonly code = 'novel_adaptation_validation_failed';
  readonly returnedDraft: string;
  constructor(message: string, returnedDraft: string) { super(message); this.name = 'NovelAdaptationValidationError'; this.returnedDraft = returnedDraft; }
}

function productionScriptSchema(production: IdeaProductionBrief) {
  const properties = { ...ideaScriptSchema.properties } as Record<string, unknown>;
  for (const key of ['durationSec', 'ratio', 'language', 'emotion', 'workType'] as const) {
    properties[key] = { type: typeof production[key] === 'number' ? 'integer' : 'string', enum: [production[key]] };
  }
  properties.episodeNumber = { type: 'integer', enum: [1] };
  if (production.workType === 'single' || production.episodeCountMode === 'fixed') {
    properties.plannedEpisodeCount = { type: 'integer', enum: [production.workType === 'single' ? 1 : production.episodeCount] };
  }
  return { ...ideaScriptSchema, properties };
}

function preserveValidation(script: IdeaScript, production: IdeaProductionBrief, validate: (script: IdeaScript, production: IdeaProductionBrief) => void) {
  try { validate(script, production); }
  catch (error) { throw new NovelAdaptationValidationError(error instanceof Error ? error.message : '剧本校验失败。', JSON.stringify(script, null, 2)); }
}

function validateProductionValues(script: IdeaScript, production: IdeaProductionBrief) {
  const names = { durationSec: '单集时长', ratio: '画幅', language: '语言', emotion: '情绪' };
  const mismatches = (Object.keys(names) as Array<keyof typeof names>).filter(key => script[key] !== production[key]);
  if (mismatches.length) throw new Error(`返回剧本参数与已确认设置不一致：${mismatches.map(key => `${names[key]}要求“${production[key]}”，返回“${script[key]}”`).join('；')}。返回稿已保留，尚未确认。`);
}

export async function adaptNovelToSingleScript(
  provider: AgentProvider,
  input: NovelAdaptationInput,
  options: { maxOutputTokens?: number } = {}
): Promise<IdeaScript> {
  const novelText = normalizeNovelText(input.novelText);
  if (novelText.length < 20) throw new Error('小说内容过短，无法改编。');
  if (novelText.length > 120_000) throw new Error('单次剧本改编最多读取12万字，请先选择要改编的章节。');
  if (input.production.workType !== 'single') throw new Error('单条脚本改编只接受单条作品参数。');
  const creativeDirection = input.production.creativeDirection || 'story';
  const directionInstruction = {
    story: '围绕用户确认的主情绪选取最适合指定时长的完整事件，允许压缩、合并非关键动作，但必须在指定总时长内形成开端、升级、高潮与结尾。',
    commercial: '把素材中可确认的品牌、产品、活动与受众信息组织为完整广告营销脚本，突出已提供的核心卖点、传播目标与片尾落点。',
    product: '把素材中可确认的产品外观、材质、功能、使用过程与结果组织为完整产品展示脚本，明确展示顺序和视觉重点。',
    knowledge: '把素材中的核心问题、事实、步骤、例证与结论组织为清晰的知识讲解脚本，确保信息顺序易于理解和执行。',
    documentary: '把素材中的真实人物、事件、时间、地点、采访和现场信息组织为纪录纪实脚本；严格区分已知事实与未知信息，不补写虚构事实。',
    music_visual: '把素材中的音乐结构、歌词主题、视觉意象、节奏段落与氛围变化组织为完整的音乐视觉脚本，让画面变化与声音结构清晰对应。',
  }[creativeDirection];

  const result = await provider.generate<IdeaScript>({
    operation: 'adapt-novel-to-single-short-video',
    schemaName: 'novel_single_script_v1',
    maxOutputTokens: options.maxOutputTokens ?? TEXT_TOKEN_BUDGETS.formalDraft,
    instructions: [
      '你是PRISM AutoDrama的编剧导演，负责把用户提供的原文改编成一条可直接制作的中文脚本。',
      '忠于原文中的人物、关系、关键事件与世界设定；不得把无来源的新人物、新关系或关键事实写成原著事实。',
      directionInstruction,
      '作品方向不要求人物或冲突时，直接采用适合该方向的非剧情结构；characters只列确实出镜且需要身份连续的人物或角色，没有则返回空数组。',
      '正式剧本采用可直接阅读和表演的场景格式。每场blocks必须按照实际发生顺序交织动作、对白、内心OS、音效和转场。',
      '每个对白或内心OS块写明speaker和delivery；动作块必须是可见、可拍摄的行为。',
      'durationSec、ratio、language、emotion与workType必须逐字遵循production。plannedEpisodeCount与episodeNumber均为1，seriesPlan返回空数组。',
      '只输出结构化剧本，不解释工作过程。'
    ].join('\n'),
    input: {
      sourceName: input.sourceName,
      novelText,
      production: input.production
    },
    outputSchema: productionScriptSchema(input.production)
  });

  preserveValidation(result.output, input.production, validateScript);
  return result.output;
}

export async function adaptNovelToSeriesPlan(
  provider: AgentProvider,
  input: NovelAdaptationInput,
  options: { maxOutputTokens?: number } = {}
): Promise<IdeaScript> {
  const novelText = normalizeNovelText(input.novelText);
  if (novelText.length < 20) throw new Error('小说内容过短，无法拆分系列。');
  if (novelText.length > 120_000) throw new Error('单次系列规划最多读取12万字，请先选择要规划的章节。');
  if (input.production.workType !== 'series') throw new Error('系列规划只接受系列作品参数。');
  const creativeDirection = input.production.creativeDirection || 'story';
  const directionInstruction = {
    story: '依据原文事件顺序、人物关系与因果链规划连续剧集；每集形成独立推进，并在集尾留下来自原文的下一步动力。',
    commercial: '依据素材中的品牌、产品、活动和受众信息规划系列营销内容；每集聚焦一个明确卖点或传播任务。',
    product: '依据素材中的产品外观、材质、功能、使用过程与结果规划系列展示内容；每集承担一个清晰的展示主题。',
    knowledge: '依据素材中的问题、事实、步骤、例证与结论规划系列讲解内容；各集难度和信息顺序逐步推进。',
    documentary: '依据素材中可确认的人物、事件、时间、地点、采访和现场信息规划纪实系列；不得把推测写成事实。',
    music_visual: '依据素材中的音乐结构、歌词主题、视觉意象与节奏段落规划系列视觉内容；每集有明确的视听主题。',
  }[creativeDirection];
  const episodeCountInstruction = input.production.episodeCountMode === 'fixed'
    ? `用户已指定${input.production.episodeCount}集；plannedEpisodeCount必须为${input.production.episodeCount}，seriesPlan必须恰好包含${input.production.episodeCount}项。`
    : '根据素材体量在2到30集之间选择合理集数；plannedEpisodeCount必须与seriesPlan项目数完全一致。';

  const result = await provider.generate<IdeaScript>({
    operation: 'adapt-novel-to-series-plan',
    schemaName: 'novel_series_plan_v1',
    maxOutputTokens: options.maxOutputTokens ?? TEXT_TOKEN_BUDGETS.formalDraft,
    instructions: [
      '你是PRISM AutoDrama的编剧导演，负责把用户提供的原文拆分为可审核的完整系列规划，并写出第1集可直接制作的中文执行脚本。',
      '忠于原文中的人物、关系、关键事件、先后顺序与世界设定；不得把无来源的新人物、新关系或关键事实写成原著事实。',
      directionInstruction,
      episodeCountInstruction,
      'seriesPlan按集号连续排列，从第1集开始；每项包含本集标题、内容梗概和结尾收束，不能重复同一事件，也不能越过重要因果环节。',
      'scenes只写第1集的正式执行脚本，不得把整季内容塞进第1集；episodeNumber必须为1。',
      '第1集采用可直接阅读和表演的场景格式。每场blocks按照实际发生顺序交织动作、对白、内心OS、音效和转场。',
      '每个对白或内心OS块写明speaker和delivery；动作块必须是可见、可拍摄的行为。',
      'durationSec表示单集时长；ratio、language、emotion与workType必须逐字遵循production。',
      '只输出结构化系列规划与第1集脚本，不解释工作过程。'
    ].join('\n'),
    input: {
      sourceName: input.sourceName,
      novelText,
      production: input.production
    },
    outputSchema: productionScriptSchema(input.production)
  });

  preserveValidation(result.output, input.production, validateSeriesPlan);
  return result.output;
}

function validateScript(script: IdeaScript, production: IdeaProductionBrief) {
  if (!script || !script.title?.trim() || !Array.isArray(script.characters) || !Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error('文字Agent没有返回完整剧本。');
  }
  validateProductionValues(script, production);
  if (script.workType !== 'single') throw new Error('文字Agent返回了错误的作品形态。');
}

function validateSeriesPlan(script: IdeaScript, production: IdeaProductionBrief) {
  if (!script || !script.title?.trim() || !Array.isArray(script.characters) || !Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error('文字Agent没有返回完整的系列规划和第1集脚本。');
  }
  validateProductionValues(script, production);
  if (script.workType !== 'series' || script.episodeNumber !== 1) throw new Error('文字Agent返回了错误的系列作品形态或集号。');
  if (!Number.isInteger(script.plannedEpisodeCount) || script.plannedEpisodeCount < 2 || script.plannedEpisodeCount > 30) {
    throw new Error('文字Agent返回的系列集数无效。');
  }
  if (!Array.isArray(script.seriesPlan) || script.seriesPlan.length !== script.plannedEpisodeCount) {
    throw new Error('文字Agent返回的分集数量与系列规划不一致。');
  }
  if (production.episodeCountMode === 'fixed' && script.plannedEpisodeCount !== production.episodeCount) {
    throw new Error('文字Agent没有遵循已确认的系列集数。');
  }
  script.seriesPlan.forEach((episode, index) => {
    if (episode.episodeNumber !== index + 1 || !episode.title?.trim() || !episode.summary?.trim() || !episode.hook?.trim()) {
      throw new Error(`文字Agent返回的第${index + 1}集规划不完整或集号不连续。`);
    }
  });
}
