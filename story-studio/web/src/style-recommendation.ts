export type StyleRecommendationPreset = {
  id: string;
  recommendationPriority: number;
};

export function rankStylePresets<T extends StyleRecommendationPreset>(presets: T[]): T[] {
  return presets
    .map((preset, index) => ({ preset, index }))
    .sort((left, right) => left.preset.recommendationPriority - right.preset.recommendationPriority || left.index - right.index)
    .map((item) => item.preset);
}
