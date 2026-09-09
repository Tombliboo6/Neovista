import { normalizeStylePresetId } from '../styles/presets.ts';

export const DEFAULT_GENERATION_STYLE_ID = 'ancient-live-action';
export const GENERATION_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
export const IMAGE_RESOLUTION_TIERS = ['1k', '2k', '4k'] as const;
export const IMAGE_REQUEST_ASPECT_RATIOS = [...GENERATION_ASPECT_RATIOS, '3:2', '2:3'] as const;

export type GenerationAspectRatio = (typeof GENERATION_ASPECT_RATIOS)[number];
export type ImageResolutionTier = (typeof IMAGE_RESOLUTION_TIERS)[number];
export type ImageRequestAspectRatio = (typeof IMAGE_REQUEST_ASPECT_RATIOS)[number];

const IMAGE_REQUEST_SIZE_TABLE: Record<ImageResolutionTier, Record<ImageRequestAspectRatio, { width: number; height: number }>> = {
  '1k': {
    '16:9': { width: 1536, height: 1024 },
    '9:16': { width: 1024, height: 1536 },
    '1:1': { width: 1024, height: 1024 },
    '4:3': { width: 1536, height: 1024 },
    '3:4': { width: 1024, height: 1536 },
    '3:2': { width: 1536, height: 1024 },
    '2:3': { width: 1024, height: 1536 },
  },
  '2k': {
    '16:9': { width: 2048, height: 1152 },
    '9:16': { width: 1152, height: 2048 },
    '1:1': { width: 2048, height: 2048 },
    '4:3': { width: 2048, height: 1536 },
    '3:4': { width: 1536, height: 2048 },
    '3:2': { width: 2048, height: 1360 },
    '2:3': { width: 1360, height: 2048 },
  },
  '4k': {
    '16:9': { width: 3840, height: 2160 },
    '9:16': { width: 2160, height: 3840 },
    '1:1': { width: 2880, height: 2880 },
    '4:3': { width: 3264, height: 2448 },
    '3:4': { width: 2448, height: 3264 },
    '3:2': { width: 3504, height: 2336 },
    '2:3': { width: 2336, height: 3504 },
  },
};

export interface GenerationPresetSnapshot {
  id: string;
  version: number;
  styleId: string;
  aspectRatio: GenerationAspectRatio;
  imageResolution: ImageResolutionTier;
  createdAt: string;
}

export interface GenerationPresetInput {
  id?: unknown;
  version?: unknown;
  styleId?: unknown;
  aspectRatio?: unknown;
  imageResolution?: unknown;
  createdAt?: unknown;
}

export function normalizeGenerationAspectRatio(value: unknown, fallback: GenerationAspectRatio = '16:9'): GenerationAspectRatio {
  return GENERATION_ASPECT_RATIOS.includes(value as GenerationAspectRatio) ? value as GenerationAspectRatio : fallback;
}

export function normalizeImageResolutionTier(value: unknown, fallback: ImageResolutionTier = '1k'): ImageResolutionTier {
  return IMAGE_RESOLUTION_TIERS.includes(value as ImageResolutionTier) ? value as ImageResolutionTier : fallback;
}

export function normalizeGenerationPreset(
  value: GenerationPresetInput | null | undefined,
  legacy: { styleId?: unknown; aspectRatio?: unknown; imageResolution?: unknown } = {},
  timestamp = new Date().toISOString(),
): GenerationPresetSnapshot {
  const rawStyleId = String(value?.styleId || legacy.styleId || DEFAULT_GENERATION_STYLE_ID);
  const normalizedStyleId = normalizeStylePresetId(rawStyleId) || DEFAULT_GENERATION_STYLE_ID;
  return {
    id: typeof value?.id === 'string' && value.id.trim() ? value.id.trim().slice(0, 200) : 'project-generation-preset',
    version: Number.isInteger(Number(value?.version)) ? Math.max(1, Math.min(100_000, Number(value?.version))) : 1,
    styleId: normalizedStyleId,
    aspectRatio: normalizeGenerationAspectRatio(value?.aspectRatio, normalizeGenerationAspectRatio(legacy.aspectRatio)),
    imageResolution: normalizeImageResolutionTier(value?.imageResolution, normalizeImageResolutionTier(legacy.imageResolution)),
    createdAt: typeof value?.createdAt === 'string' && value.createdAt.trim() ? value.createdAt.trim().slice(0, 100) : timestamp,
  };
}

export function evolveGenerationPreset(
  current: GenerationPresetSnapshot,
  patch: Partial<Pick<GenerationPresetSnapshot, 'styleId' | 'aspectRatio' | 'imageResolution'>>,
  timestamp = new Date().toISOString(),
): GenerationPresetSnapshot {
  const nextStyleId = normalizeStylePresetId(String(patch.styleId || current.styleId)) || DEFAULT_GENERATION_STYLE_ID;
  const nextAspectRatio = normalizeGenerationAspectRatio(patch.aspectRatio, current.aspectRatio);
  const nextImageResolution = normalizeImageResolutionTier(patch.imageResolution, current.imageResolution);
  if (nextStyleId === current.styleId && nextAspectRatio === current.aspectRatio && nextImageResolution === current.imageResolution) return current;
  return {
    id: current.id,
    version: current.version + 1,
    styleId: nextStyleId,
    aspectRatio: nextAspectRatio,
    imageResolution: nextImageResolution,
    createdAt: timestamp,
  };
}

export function isGenerationStyleCompatible(
  reference: Pick<GenerationPresetSnapshot, 'styleId'> | null | undefined,
  current: Pick<GenerationPresetSnapshot, 'styleId'>,
): boolean {
  return !reference || normalizeStylePresetId(reference.styleId) === normalizeStylePresetId(current.styleId);
}

export function imageRequestSizeForAspectRatio(
  aspectRatio: ImageRequestAspectRatio,
  imageResolution: ImageResolutionTier = '1k',
): { width: number; height: number } {
  return { ...IMAGE_REQUEST_SIZE_TABLE[normalizeImageResolutionTier(imageResolution)][aspectRatio] };
}

export function applyGenerationPresetToPrompt(prompt: string, preset: GenerationPresetSnapshot): string {
  const clean = String(prompt || '').trim();
  const ratioLine = `目标画面比例：${preset.aspectRatio}。构图、主体位置、留白和镜头运动均按该画幅设计。`;
  return clean.includes(`目标画面比例：${preset.aspectRatio}`) ? clean : `${clean}\n\n${ratioLine}`.trim();
}
