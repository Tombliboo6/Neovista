import type { CreativeAsset } from '../domain/contracts.js';
import type { ImageGenerationRequest } from '../providers/contracts.js';

export const SCENE_VIEW_NEGATIVE_TERMS = [
  '地点身份或画风漂移',
  '固定地标缺失、增减或位置互换',
  '道路、出入口或空间轴线反转',
  '天气、时间或基础环境状态变化',
  '人物、怪物、人群或角色剪影',
  '武器、剧情道具或可移动陈设混入',
  '视角重复、宫格数量错误或透视冲突',
  '文字标签、Logo或水印'
] as const;

export interface SceneViewRequestInput {
  taskId: string;
  mainAsset: CreativeAsset;
  referenceEditMode: 'disabled' | 'probe' | 'verified';
  fixedLandmarks: string[];
  spatialLayout: string;
  width?: number;
  height?: number;
}

export class SceneViewValidationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SceneViewValidationError';
    this.code = code;
  }
}

export function compileSceneViewPrompt(input: Pick<SceneViewRequestInput, 'fixedLandmarks' | 'spatialLayout'>): string {
  const fixedLandmarks = Array.isArray(input.fixedLandmarks) ? input.fixedLandmarks.map((item) => item.trim()).filter(Boolean) : [];
  const spatialLayout = input.spatialLayout.trim();
  if (!spatialLayout) throw new SceneViewValidationError('Scene views require a stable spatial layout.', 'invalid_spatial_layout');
  return [
    '场景主资产参考：当前上传的唯一图片（唯一地点、画风、材质、天气、基础状态与空间身份参考）',
    '',
    '关键限制',
    '四个画格必须表现参考图中的同一物理地点，只改变摄影机观察方位；固定地标、相对位置、道路或通道轴线、出入口、天气、时间和基础环境状态保持一致。',
    `固定地标：${fixedLandmarks.length ? fixedLandmarks.join('、') : '以场景主图中可辨认的稳定结构为准'}。`,
    `空间连续性：${spatialLayout}。`,
    '',
    '基础设定',
    '生成一张横版3:2的场景四宫格多角度资产板。主体是参考图中的同一处纯环境场景，沿用当前主图的稳定设计，不加入人物或剧情道具。',
    '',
    '氛围、画质与摄影风格',
    '严格沿用参考图的画风、渲染方式、光色、曝光、天气、材质语言和细节密度。四格色彩、空气透视、地面湿度或植被状态完全统一，达到可供后续分镜匹配的电影级环境概念设计质量。',
    '',
    '画面内容与布局',
    '严格2列×2行四宫格，四格等宽等高且边界清楚。左上为主轴建立视角；右上为沿同一轴线转向约180度的反打视角；左下为左侧横向观察视角；右下为略高机位的斜俯全局视角。每格都应能辨认主要固定地标，并让它们的相对远近、左右关系、道路连接和遮挡关系彼此可推导。',
    '',
    '摄影机与成像',
    '四格均使用自然广角建立镜头观感，机位高度与透视符合真实空间；除右下略高机位外，其余保持接近人眼高度。深景深，前中后景结构清楚，禁止为了构图任意镜像、搬移或重建场景。',
    '',
    '负面词',
    SCENE_VIEW_NEGATIVE_TERMS.join('，')
  ].join('\n');
}

export function buildSceneViewRequest(input: SceneViewRequestInput): ImageGenerationRequest {
  if (input.mainAsset.kind !== 'scene') {
    throw new SceneViewValidationError('Scene views require a scene main asset.', 'invalid_parent_asset');
  }
  if (input.mainAsset.mediaPaths.length !== 1) {
    throw new SceneViewValidationError('Scene views require exactly one available main image.', 'invalid_reference_count');
  }
  if (input.referenceEditMode === 'disabled') {
    throw new SceneViewValidationError('Reference-image editing is not verified.', 'image_edit_not_verified');
  }
  const width = input.width ?? 1536;
  const height = input.height ?? 1024;
  return {
    taskId: input.taskId.trim(),
    prompt: compileSceneViewPrompt(input),
    sourceEntityIds: [input.mainAsset.id],
    sourceEntityVersions: { [input.mainAsset.id]: input.mainAsset.version },
    referenceAssetIds: [input.mainAsset.id],
    referenceAssetVersions: { [input.mainAsset.id]: input.mainAsset.version },
    referenceMediaPaths: [...input.mainAsset.mediaPaths],
    width,
    height,
    count: 1,
    quality: 'high',
    outputFormat: 'png'
  };
}
