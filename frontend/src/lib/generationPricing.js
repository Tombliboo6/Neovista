export const RESOLUTION_PRICING = {
  '1K': 30,
  '2K': 50,
  '4K': 90,
};

export function calculateGenerationCost(resolution, numImages) {
  return RESOLUTION_PRICING[resolution] * numImages;
}
