export type StylePresetCategory = '真人' | '3D' | '2D' | '插画' | '传统绘画' | '漫画';

export interface StylePresetDefinition {
  id: string;
  name: string;
  description: string;
  styleAnchor: string;
  category: StylePresetCategory;
  recommendationPriority: number;
  previewPalette: [string, string, string];
  previewLabel: string;
  previewMediaPath: string;
}

export const STYLE_PRESETS: readonly StylePresetDefinition[] = [
  {
    id: 'ancient-live-action', name: '真人电影写实', description: '真实人物、自然皮肤与电影摄影质感。',
    category: '真人', recommendationPriority: 10, previewPalette: ['#20252b', '#69737b', '#d2a986'], previewLabel: '真人电影', previewMediaPath: 'runtime-data/style-presets/v2/01-真人电影写实.png',
    styleAnchor: '高品质真人电影写实画风，人物保持真实自然的面部结构、皮肤纹理、毛孔、细微表情与自然不对称，身体比例准确。服装、道具、建筑和环境材质符合真实物理属性，织物、木材、金属、玻璃与皮革的反光和粗糙度可信。使用电影级曝光、自然景深、准确白平衡与克制色彩分级，明暗层次完整，画面保持真实摄影成像、稳定人物辨识度和连续镜头一致性。'
  },
  {
    id: '3d-fantasy', name: '影视级写实CG', description: '接近实拍的写实三维影视渲染。',
    category: '3D', recommendationPriority: 70, previewPalette: ['#17222b', '#4f7182', '#c8d8df'], previewLabel: '写实CG', previewMediaPath: 'runtime-data/style-presets/v2/02-影视级写实CG.png',
    styleAnchor: '影视级写实CG画风，人物采用真实人体比例与高精度三维建模，面部结构、皮肤次表面散射、发丝和服装结构清晰稳定。所有物体使用可信的物理材质与光照响应，细节丰富但有层级。采用电影级全局光照、体积空间、自然景深和准确色彩管理，画面明确呈现高端三维渲染质感，同时保持接近实拍的可信度与连续制作一致性。'
  },
  {
    id: 'ancient-3d-drama', name: '风格化3D动画', description: '常见3D漫剧向的概括造型与动画渲染。',
    category: '3D', recommendationPriority: 40, previewPalette: ['#183b4a', '#4ca1a5', '#edbd77'], previewLabel: '风格化三维', previewMediaPath: 'runtime-data/style-presets/v2/03-风格化3D动画.png',
    styleAnchor: '高品质风格化3D动画画风，人物比例经过艺术概括但保持自然协调，面部、发束、服装和身体轮廓清晰稳定，表情与肢体动作具有良好可读性。使用精细三维建模、柔和物理材质、自然全局光照和动画电影式空间层次，色彩协调、形体简洁、细节不过度堆砌，人物与环境共享统一的造型语言和渲染质感。'
  },
  {
    id: 'ancient-2d-drama', name: '2D赛璐璐动画', description: '清晰线稿、干净色块与分层赛璐璐明暗。',
    category: '2D', recommendationPriority: 60, previewPalette: ['#24314a', '#d05d80', '#eed296'], previewLabel: '赛璐璐二维', previewMediaPath: 'runtime-data/style-presets/v2/04-2D赛璐璐动画.png',
    styleAnchor: '高品质2D赛璐璐动画画风，人物比例自然，轮廓和五官稳定，线稿流畅并具有明确粗细节奏。使用干净色块、两至三阶细腻赛璐璐明暗与少量准确高光塑造体积，发束、服装褶皱和环境透视清楚。色彩边界整洁，人物和场景保持统一线条、上色方式与动画叙事可读性。'
  },
  {
    id: 'modern-2d-drama', name: '2D国漫厚涂', description: '东方人物造型、厚涂明暗与精细二维质感。',
    category: '2D', recommendationPriority: 20, previewPalette: ['#28304b', '#9c4f72', '#e5b46f'], previewLabel: '国漫厚涂', previewMediaPath: 'runtime-data/style-presets/v2/05-2D国漫厚涂.png',
    styleAnchor: '高品质2D国漫厚涂画风，人物采用稳定而具有辨识度的东方审美比例，五官、发型和轮廓刻画精炼。线稿与厚涂色块自然融合，使用连续柔和的明暗、明确体积和精细材质笔触表现皮肤、织物、金属与环境。色彩层次丰富而有秩序，画面兼具二维绘画质感、人物表现力和连续漫剧制作的一致性。'
  },
  {
    id: 'webtoon-comic', name: '条漫／网漫风', description: '干净人物、高可读表情与轻量漫画渲染。',
    category: '漫画', recommendationPriority: 30, previewPalette: ['#f1d9df', '#bd6e91', '#3c3545'], previewLabel: '条漫网漫', previewMediaPath: 'runtime-data/style-presets/v2/06-条漫／网漫风.png',
    styleAnchor: '高品质条漫与网漫画风，人物轮廓干净、五官精致稳定、表情和动作高度可读，身体比例自然修长。使用清晰线稿、柔和渐变上色、克制高光与轻量背景细节，重要人物和动作拥有明确视觉优先级。画面保持整洁的数字漫画质感、稳定角色辨识度和适合连续叙事的统一绘制方式。'
  },
  {
    id: 'commercial-hand-painted', name: '商业手绘插画', description: '成熟手绘笔触、完整空间与统一插画质感。',
    category: '插画', recommendationPriority: 50, previewPalette: ['#536e86', '#d88d7e', '#ead6a9'], previewLabel: '手绘插画', previewMediaPath: 'runtime-data/style-presets/v2/07-商业手绘插画.png',
    styleAnchor: '高品质商业手绘插画画风，人物和环境使用统一的手绘造型语言，轮廓自然，笔触可见但保持整洁，色块与明暗关系完整。人物比例、五官和服装细节稳定，空间透视与前中后景清楚。色彩具有成熟插画层次，材质通过笔触和色彩变化表达，画面适合连续剧情制作并保持稳定一致。'
  },
  {
    id: 'watercolor-picture-book', name: '水彩绘本', description: '透明水彩晕染、纸张纹理与轻盈手绘边缘。',
    category: '插画', recommendationPriority: 90, previewPalette: ['#a8c6cf', '#e5a79b', '#f2e4c8'], previewLabel: '水彩绘本', previewMediaPath: 'runtime-data/style-presets/v2/08-水彩绘本.png',
    styleAnchor: '高品质水彩绘本画风，使用透明水彩叠色、自然水痕、柔和晕染与可见纸张纹理表现人物和环境。轮廓轻盈而准确，五官、姿态和重要物体保持清楚可读，局部留白与颜料浓淡形成空间层次。画面具有真实手绘材料感、统一色彩关系和连续页面般的视觉一致性。'
  },
  {
    id: 'chinese-ink-wash', name: '国风水墨', description: '墨色浓淡、宣纸肌理与东方留白。',
    category: '传统绘画', recommendationPriority: 80, previewPalette: ['#e3ded2', '#77766f', '#171717'], previewLabel: '水墨留白', previewMediaPath: 'runtime-data/style-presets/v2/09-国风水墨.png',
    styleAnchor: '高品质国风水墨画风，以富有呼吸感的墨线、浓淡干湿变化和自然晕染塑造人物与环境，宣纸纤维和水色渗化细腻可见。人物五官和动作简练而准确，衣纹、建筑与物体通过书写性线条和墨块概括。构图强调留白、虚实相生和气韵流动，所有画面保持统一笔触、纸面质感与叙事可读性。'
  },
  {
    id: 'eastern-classical-decoration', name: '工笔重彩', description: '精细勾线、矿物重彩与平面装饰秩序。',
    category: '传统绘画', recommendationPriority: 100, previewPalette: ['#285451', '#b84c36', '#d8b55c'], previewLabel: '工笔重彩', previewMediaPath: 'runtime-data/style-presets/v2/10-工笔重彩.png',
    styleAnchor: '高品质工笔重彩画风，人物、服饰、建筑与器物采用精细稳定的勾线和层层罩染，形体准确，纹样与细节疏密有序。使用石青、石绿、朱砂、赭石与金色等矿物色形成饱满而典雅的平面色彩，材质通过线条、罩染和装饰纹理表达。画面强调秩序、层级、留白与统一的传统绘画质感。'
  },
  {
    id: 'classical-theatre-lighting', name: '古典油画', description: '油画笔触、厚重色层与古典明暗塑形。',
    category: '传统绘画', recommendationPriority: 110, previewPalette: ['#241916', '#70462f', '#d3a162'], previewLabel: '古典油画', previewMediaPath: 'runtime-data/style-presets/v2/11-古典油画.png',
    styleAnchor: '高品质古典油画画风，人物和环境使用可见油画笔触、厚薄变化的颜料层与细腻综合色塑造。人物结构准确，面部、手势、服装和主要物体通过古典明暗法建立体积，暗部深沉但保留色彩层次，高光集中而克制。画布肌理、色层和笔触方向自然统一，画面保持完整的绘画材料感和连续作品一致性。'
  },
  {
    id: 'black-white-comic', name: '黑白漫画', description: '黑白线条、网点灰阶与强烈图形对比。',
    category: '漫画', recommendationPriority: 120, previewPalette: ['#f0f0ec', '#737373', '#101010'], previewLabel: '黑白漫画', previewMediaPath: 'runtime-data/style-presets/v2/12-黑白漫画.png',
    styleAnchor: '高品质黑白漫画画风，使用稳定清晰的墨线、粗细变化、黑白块面和细腻网点灰阶塑造人物与环境。五官、动作、服装和重要物体轮廓明确，明暗对比服务空间层次和叙事可读性。画面保持纯粹黑白印刷质感、统一排线方向与连续漫画绘制的一致性。'
  }
] as const;

const LEGACY_STYLE_ID_MAP: Readonly<Record<string, string>> = {
  'ethereal-gothic': 'classical-theatre-lighting',
  'modern-social-realism': 'ancient-live-action',
  'urban-cinematic': 'ancient-live-action',
  'documentary-natural-light': 'ancient-live-action',
  'modern-suspense': 'ancient-live-action',
  'modern-3d-animation': 'ancient-3d-drama',
  'youth-illustration-animation': 'commercial-hand-painted',
  'cyber-scifi-cinema': '3d-fantasy'
};

export function normalizeStylePresetId(id: string): string {
  return LEGACY_STYLE_ID_MAP[id] ?? id;
}

export function getStylePreset(id: string): StylePresetDefinition {
  const normalizedId = normalizeStylePresetId(id);
  const preset = STYLE_PRESETS.find((item) => item.id === normalizedId);
  if (!preset) throw new Error(`Unknown style preset: ${id}`);
  return preset;
}
