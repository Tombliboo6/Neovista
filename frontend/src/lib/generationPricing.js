export const DEFAULT_GENERATION_MODEL = 'nano-banana-2';

export const BASE_RESOLUTION_PRICING = {
  '1K': 30,
  '2K': 50,
  '4K': 90,
};

const MODEL_SURCHARGE_PER_IMAGE = {
  'nano-banana-2': 0,
  'nano-banana-pro': 30,
  'gpt-image-2': 0,
};

export const RESOLUTION_PRICING = BASE_RESOLUTION_PRICING;

export function normalizeGenerationModel(selectedModel = DEFAULT_GENERATION_MODEL) {
  return MODEL_SURCHARGE_PER_IMAGE[selectedModel] !== undefined
    ? selectedModel
    : DEFAULT_GENERATION_MODEL;
}

export function getResolutionPricing(selectedModel = DEFAULT_GENERATION_MODEL) {
  const normalizedModel = normalizeGenerationModel(selectedModel);
  const surcharge = MODEL_SURCHARGE_PER_IMAGE[normalizedModel];

  if (surcharge === 0) {
    return BASE_RESOLUTION_PRICING;
  }

  return Object.fromEntries(
    Object.entries(BASE_RESOLUTION_PRICING).map(([resolution, price]) => [
      resolution,
      price + surcharge,
    ]),
  );
}

export function calculateGenerationCost(
  resolution,
  numImages,
  selectedModel = DEFAULT_GENERATION_MODEL,
) {
  return getResolutionPricing(selectedModel)[resolution] * numImages;
}
