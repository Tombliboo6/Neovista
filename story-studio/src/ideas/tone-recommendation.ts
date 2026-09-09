import type { AgentProvider } from '../providers/contracts.js';

export type RecommendedToneColor = 'cyan' | 'violet' | 'blue' | 'red' | 'gold';

export interface RecommendedTone {
  name: string;
  note: string;
  tone: RecommendedToneColor;
}

export interface ToneRecommendationInput {
  sourceText: string;
  creationSource: 'novel' | 'idea';
  workType: 'single' | 'series';
  creativeDirection: 'story' | 'commercial' | 'product' | 'knowledge' | 'documentary' | 'music_visual';
  durationSec: number;
  ratio: string;
  language: string;
}

const recommendationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recommendations: {
      type: 'array', minItems: 4, maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 20 },
          note: { type: 'string', minLength: 8, maxLength: 40 },
          tone: { type: 'string', enum: ['cyan', 'violet', 'blue', 'red', 'gold'] },
        },
        required: ['name', 'note', 'tone'],
      },
    },
  },
  required: ['recommendations'],
} as const;

export async function recommendCreativeTones(provider: AgentProvider, input: ToneRecommendationInput): Promise<RecommendedTone[]> {
  const sourceText = input.sourceText.trim();
  if (sourceText.length < 2 || sourceText.length > 20_000) throw new Error('用于推荐情绪的内容长度无效。');
  if (!Number.isInteger(input.durationSec) || input.durationSec < 5 || input.durationSec > 600) throw new Error('影片时长无效。');

  const result = await provider.generate<{ recommendations: RecommendedTone[] }>({
    operation: 'recommend-creative-tones',
    schemaName: 'creative_tone_recommendations_v1',
    maxOutputTokens: 4_000,
    instructions: [
      '你是PRISM Story Studio的编剧导演。根据用户素材和已确认的作品参数，推荐4个最适合的主情绪或表达气质。',
      '不要从固定词表挑选；从完整的中文情绪与审美表达中动态判断，可以使用克制愤怒、荒诞压迫、温暖释怀、冷峻宿命等更精确的复合表达。',
      '推荐按适配度从高到低排序，第一项是你的首选。4项必须方向清晰、彼此有真实差异，但都不得改变素材中的人物、事件、因果和事实。',
      'name使用完整自然的中文短语，通常4至12字，最长20字；必须保留完整词语，较长时改写为完整短语，不得截断词尾凑字数。note用一句8至40字的制作说明，讲清它会怎样影响节奏、表演或视觉表达。',
      'tone只用于界面色彩：cyan偏克制或清冷，violet偏神秘或诗意，blue偏理性或紧张，red偏强烈或对抗，gold偏温暖或庄重。',
      '只返回结构化结果，不解释工作过程。',
    ].join('\n'),
    input,
    outputSchema: recommendationSchema,
  });

  const seen = new Set<string>();
  const recommendations = (Array.isArray(result.output?.recommendations) ? result.output.recommendations : []).flatMap((item): RecommendedTone[] => {
    const name = item?.name?.trim();
    const note = item?.note?.trim();
    const tone = item?.tone;
    if (!name || name.length < 2 || name.length > 20 || !note || seen.has(name) || !['cyan', 'violet', 'blue', 'red', 'gold'].includes(tone)) return [];
    seen.add(name);
    return [{ name, note, tone }];
  });
  if (recommendations.length !== 4) throw new Error('情绪推荐结果不完整，请重新获取。');
  return recommendations;
}
