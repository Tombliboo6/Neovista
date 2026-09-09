import type { EntityId, GenerationTask } from '../domain/contracts.js';

export type ProviderHealthStatus =
  | 'ok'
  | 'not_configured'
  | 'auth_error'
  | 'rate_limited'
  | 'out_of_credits'
  | 'backend_offline'
  | 'model_missing'
  | 'node_missing'
  | 'queue_busy'
  | 'vram_insufficient'
  | 'down';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  message: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

export interface AgentImageInput {
  /** Stable attachment identity, scoped to the segment in batched requests. */
  id: string;
  description: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: string;
}

export interface AgentRequest<TInput = unknown> {
  operation: string;
  input: TInput;
  schemaName: string;
  instructions: string;
  outputSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  images?: AgentImageInput[];
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  reportedTotalTokens?: number;
  calculatedTotalTokens?: number;
  accountingConsistent?: boolean;
}

export interface AgentGenerationResult<TOutput> {
  output: TOutput;
  providerId: string;
  model: string;
  externalTaskId?: string;
  status: 'completed';
  completedAt: string;
  elapsedMs: number;
  usage?: AgentUsage;
  recovery?: {
    attemptCount: number;
    retryCount: number;
    recoveredAfterTransientFailure: true;
    transientFailures: Array<{
      attempt: number;
      status: number;
      code?: string;
      externalTaskId?: string;
      elapsedMs: number;
      retryDelayMs: number;
    }>;
  };
}

export interface AgentProvider {
  readonly id: string;
  health(): Promise<ProviderHealth>;
  generate<TOutput>(request: AgentRequest): Promise<AgentGenerationResult<TOutput>>;
}

export interface ImageGenerationRequest {
  taskId: EntityId;
  targetKeys?: string[];
  prompt: string;
  sourceEntityIds: EntityId[];
  sourceEntityVersions?: Record<EntityId, number>;
  referenceAssetIds: EntityId[];
  referenceAssetVersions?: Record<EntityId, number>;
  referenceMediaPaths: string[];
  width: number;
  height: number;
  count: number;
  quality?: 'auto' | 'low' | 'medium' | 'high';
  outputFormat?: 'png' | 'webp' | 'jpeg';
}

export interface ImageProvider {
  readonly id: string;
  health(): Promise<ProviderHealth>;
  submit(request: ImageGenerationRequest): Promise<GenerationTask>;
}

export interface ImageToolRequest {
  taskId: EntityId;
  sourcePath: string;
  operation: 'rotate-clockwise' | 'rotate-counterclockwise' | 'upscale';
  upscaleScale?: 2 | 4;
  upscaleModel?: 'general' | 'anime';
}

export interface ImageToolResult {
  taskId: EntityId;
  provider: string;
  operation: ImageToolRequest['operation'];
  outputPath: string;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  parameters: Record<string, unknown>;
}

export interface ImageToolProvider {
  readonly id: string;
  health(): Promise<ProviderHealth>;
  run(request: ImageToolRequest): Promise<ImageToolResult>;
}

export interface VideoGenerationRequest {
  taskId: EntityId;
  title: string;
  sourceEntityIds: EntityId[];
  prompt: string;
  referenceAssetIds: EntityId[];
  referenceAssetVersions?: Record<EntityId, number>;
  referenceLabels?: string[];
  referenceMediaPaths: string[];
  referenceMedia?: Array<{
    path: string;
    kind: 'image' | 'video' | 'audio';
    label?: string;
    frames?: number;
    useAudio?: boolean;
  }>;
  width: number;
  height: number;
  durationSec: number;
  inferenceSteps: number;
  precision: 'bf16';
  acceleration: string[];
  mode?: 'text' | 'first' | 'first-last' | 'reference';
  resolution?: '480p' | '720p' | '1080p' | 'custom';
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  frameFit?: 'cover' | 'stretch';
  seed?: number;
  sage?: boolean;
  spectrum?: boolean;
  accelerationModel?: 'none' | 'turbo4' | 'lightx2v-544p-v1' | 'lightx2v-768p-v1';
  turboLowVram?: boolean;
  secondPass?: boolean;
  rtxUpscale?: boolean;
  rtxUpscaleScale?: number;
  rtxUpscaleQuality?: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
  cropDelivery?: boolean;
  confirmRisk?: boolean;
  continuity?: {
    engine: 'herrgotts';
    chainId: string;
    segmentIndex: number;
    segmentCount: number;
    sourceSegmentId?: EntityId;
  };
}

export interface VideoProvider {
  readonly id: 'prism-h3' | 'minimax' | 'seedance';
  health(): Promise<ProviderHealth>;
  submit(request: VideoGenerationRequest): Promise<GenerationTask>;
  status(externalTaskId: string): Promise<GenerationTask>;
  cancel(externalTaskId: string): Promise<void>;
}

export interface MusicGenerationRequest {
  taskId: EntityId;
  sourceEntityIds: EntityId[];
  prompt: string;
  durationSec: number;
  instrumental: boolean;
  lyrics?: string;
  vocalLanguage?: string;
  seed?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: '2' | '3' | '4' | '6';
  inferenceSteps?: number;
  thinking?: boolean;
}

export interface MusicProvider {
  readonly id: 'minimax-music-3' | 'audiocpp-minimax-music-3' | 'acestep-1.5';
  health(): Promise<ProviderHealth>;
  submit(request: MusicGenerationRequest): Promise<GenerationTask>;
}
