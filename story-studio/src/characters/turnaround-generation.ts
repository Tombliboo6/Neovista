import type {
  CharacterImageAsset,
  ReviewDecision
} from '../domain/contracts.js';
import type { ImageGenerationRequest } from '../providers/contracts.js';
import { requireApprovedVersion } from '../workflow/approvals.ts';

export const CHARACTER_TURNAROUND_NEGATIVE_TERMS = [
  '身份或面部漂移',
  '服装、发型或配饰变化',
  '非严格左侧面',
  '人物裁切或缺手缺脚',
  '道具、武器或手持物',
  '多余人物、重复肢体或视图数量错误',
  '文字标签、Logo或水印',
  '广角透视畸变或三格比例不一致'
] as const;

export interface CharacterTurnaroundRequestInput {
  taskId: string;
  mainAsset: CharacterImageAsset;
  mainAssetReviewDecisions: readonly ReviewDecision[];
  referenceEditMode: 'disabled' | 'probe' | 'verified';
  width?: number;
  height?: number;
}

export class CharacterTurnaroundValidationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CharacterTurnaroundValidationError';
    this.code = code;
  }
}

export function compileCharacterTurnaroundPrompt(): string {
  return [
    '主资产参考图：当前上传的唯一图片（唯一身份、脸部、发型、体型、服装与画风参考）',
    '',
    '关键限制',
    '三个视图必须是参考图中的同一角色，身份、脸部、发型、体型、肤色、服装、鞋履和配饰完全一致。',
    '三个视图均为从头顶到鞋底完整可见的全身站姿，人物等高、等比例、共用同一地面线。',
    '人物保持自然下垂的空手站姿，不携带任何道具、武器或手持物。',
    '',
    '基础设定',
    '生成一张横版3:2的人物详细三视图资产板。主体是当前主资产参考图中的同一角色，所有稳定视觉设计严格沿用参考图，只改变观察角度。',
    '',
    '氛围、画质与摄影风格',
    '严格沿用主资产参考图已经呈现的画风、渲染方式、材质语言、色彩关系和角色造型质感。纯净中性摄影棚环境，柔和均匀棚拍光，曝光、白平衡和材质表现一致；高精度呈现脸部轮廓、发型结构、服装分层、布料与饰品材质。',
    '',
    '画面内容与布局',
    '画面由三个等宽区域组成，从左到右依次排列完整正面、严格左侧面、完整背面。三个视图均采用中性表情、头部端正、双臂自然下垂、双手放松、双腿自然并拢的标准站姿；完整展示头顶、头发轮廓、颈肩、躯干、双臂、双手、双腿和双鞋。背景、地面线、人物高度、身体比例和视图间距统一，视觉重点是人物身份一致性与身体、服装结构的清晰可检查性。',
    '',
    '摄影机与成像',
    '三格分别使用与人物正面、左侧和背面正交的平视机位，机位高度、拍摄距离和焦点保持一致；使用约85毫米标准长焦观感，接近正交投影的自然透视，深景深，全身与服装边缘清晰，三格人物在画面中的占比完全一致。',
    '',
    '负面词',
    CHARACTER_TURNAROUND_NEGATIVE_TERMS.join('，')
  ].join('\n');
}

export function buildCharacterTurnaroundRequest(
  input: CharacterTurnaroundRequestInput
): ImageGenerationRequest {
  const mainAsset = input.mainAsset;
  if (mainAsset.kind !== 'character' || mainAsset.presentation !== 'main-card') {
    throw new CharacterTurnaroundValidationError(
      'Detailed turnaround generation requires a character main-card asset.',
      'invalid_parent_asset'
    );
  }

  try {
    requireApprovedVersion(mainAsset, input.mainAssetReviewDecisions);
  } catch {
    throw new CharacterTurnaroundValidationError(
      `Character main asset ${mainAsset.id} version ${mainAsset.version} is not precisely approved.`,
      'main_asset_not_approved'
    );
  }

  if (mainAsset.mediaPaths.length !== 1) {
    throw new CharacterTurnaroundValidationError(
      'Detailed turnaround generation requires exactly one approved main-asset reference image.',
      'invalid_reference_count'
    );
  }

  if (input.referenceEditMode === 'disabled') {
    throw new CharacterTurnaroundValidationError(
      'Reference-image editing has not been verified for the current Images provider.',
      'image_edit_not_verified'
    );
  }

  const width = input.width ?? 1536;
  const height = input.height ?? 1024;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new CharacterTurnaroundValidationError(
      'Turnaround output dimensions must be positive integers.',
      'invalid_dimensions'
    );
  }

  return {
    taskId: required(input.taskId, 'Image task ID'),
    prompt: compileCharacterTurnaroundPrompt(),
    sourceEntityIds: [mainAsset.id],
    sourceEntityVersions: { [mainAsset.id]: mainAsset.version },
    referenceAssetIds: [mainAsset.id],
    referenceAssetVersions: { [mainAsset.id]: mainAsset.version },
    referenceMediaPaths: [...mainAsset.mediaPaths],
    width,
    height,
    count: 1,
    quality: 'high',
    outputFormat: 'png'
  };
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}
