const normalizeText = (value) => String(value || '').trim();

const unique = (items) => Array.from(new Set(items.filter(Boolean)));

const simpleHash = (value) => {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const collectConnectedNodes = ({ storyboardId, targetHandle, nodes, edges }) => {
  const sourceIds = edges
    .filter((edge) => edge.target === storyboardId && edge.targetHandle === targetHandle)
    .map((edge) => edge.source);
  return nodes.filter((node) => sourceIds.includes(node.id));
};

const characterConstraintLines = (node) => {
  const data = node.data || {};
  return [
    `角色：${normalizeText(data.name) || '未命名角色'}（${normalizeText(data.role) || '角色'}）`,
    normalizeText(data.description) && `身份与性格：${normalizeText(data.description)}`,
    normalizeText(data.appearanceNotes || data.visualNotes) && `外观锚点：${normalizeText(data.appearanceNotes || data.visualNotes)}`,
    normalizeText(data.wardrobeNotes) && `服装与道具：${normalizeText(data.wardrobeNotes)}`,
  ].filter(Boolean);
};

const sceneConstraintLines = (node) => {
  const data = node.data || {};
  return [
    `场景：${normalizeText(data.name) || '未命名场景'}（${normalizeText(data.time) || '时间未定'}）`,
    normalizeText(data.description) && `空间内容：${normalizeText(data.description)}`,
    normalizeText(data.visualNotes) && `光线、材质与色彩：${normalizeText(data.visualNotes)}`,
  ].filter(Boolean);
};

export function compileShotGenerationDraft({ storyboardId, shot, nodes = [], edges = [] }) {
  const storyNodes = collectConnectedNodes({ storyboardId, targetHandle: 'script', nodes, edges });
  const characterNodes = collectConnectedNodes({ storyboardId, targetHandle: 'character', nodes, edges })
    .filter((node) => node.data?.includeInGeneration !== false);
  const sceneNodes = collectConnectedNodes({ storyboardId, targetHandle: 'scene', nodes, edges })
    .filter((node) => node.data?.includeInGeneration !== false);
  const continuityNodes = collectConnectedNodes({ storyboardId, targetHandle: 'continuity', nodes, edges });
  const continuityRules = unique(continuityNodes.flatMap((node) => node.data?.selectedRules || node.data?.lockedRules || []));
  const errors = [];
  const warnings = [];
  const shotPrompt = normalizeText(shot?.prompt || shot?.description);

  if (!shotPrompt) errors.push('当前镜头缺少生成提示词');
  if (characterNodes.length === 0) warnings.push('没有连接参与生成的角色资产');
  if (sceneNodes.length === 0) warnings.push('没有连接参与生成的场景资产');

  const characterAssets = characterNodes.flatMap((node) => node.data?.referenceAssets || []);
  const sceneAssets = sceneNodes.flatMap((node) => node.data?.referenceAssets || []);
  if (continuityRules.includes('角色脸型与发型') && characterAssets.length === 0) {
    errors.push('已选择“角色脸型与发型”，但角色资产没有参考图');
  }
  if (
    continuityRules.includes('服装与道具')
    && characterNodes.some((node) => !normalizeText(node.data?.wardrobeNotes))
  ) {
    errors.push('已选择“服装与道具”，但仍有角色没有填写服装与道具锚点');
  }
  if (
    continuityRules.includes('场景光向')
    && sceneNodes.some((node) => !normalizeText(node.data?.visualNotes))
  ) {
    errors.push('已选择“场景光向”，但仍有场景没有填写光线与材质锚点');
  }
  if (continuityRules.includes('镜头轴线') && !normalizeText(shot?.axis)) {
    errors.push('已选择“镜头轴线”，但当前镜头没有填写轴线规则');
  }

  const referenceAssets = Array.from(new Map(
    [...characterAssets, ...sceneAssets].filter((asset) => asset?.id).map((asset) => [asset.id, asset]),
  ).values()).slice(0, 4);
  if (characterAssets.length + sceneAssets.length > referenceAssets.length) {
    warnings.push('参考图超过 4 张，本镜头只使用前 4 张');
  }

  const negativeConstraints = unique([
    ...characterNodes.map((node) => normalizeText(node.data?.negativePrompt)),
    ...sceneNodes.map((node) => normalizeText(node.data?.negativePrompt)),
  ]);
  const storyText = normalizeText(storyNodes[0]?.data?.text).slice(0, 800);
  const promptSections = [
    '[当前镜头]',
    `标题：${normalizeText(shot?.title) || `镜头 ${shot?.index || ''}`}`,
    `画面：${shotPrompt}`,
    `景别：${normalizeText(shot?.shotSize) || '未指定'}`,
    `运镜：${normalizeText(shot?.camera) || '未指定'}`,
    normalizeText(shot?.axis) && `轴线：${normalizeText(shot.axis)}`,
    storyText && `\n[剧情上下文]\n${storyText}`,
    characterNodes.length > 0 && `\n[角色一致性约束]\n${characterNodes.flatMap(characterConstraintLines).join('\n')}`,
    sceneNodes.length > 0 && `\n[场景一致性约束]\n${sceneNodes.flatMap(sceneConstraintLines).join('\n')}`,
    continuityRules.length > 0 && `\n[必须执行的连续性规则]\n${continuityRules.map((rule) => `- ${rule}`).join('\n')}`,
    negativeConstraints.length > 0 && `\n[禁止项]\n${negativeConstraints.map((rule) => `- ${rule}`).join('\n')}`,
    '\n严格保持参考图中的角色身份特征与已声明资产一致；不要自行替换角色、服装、道具或场景设定。',
  ].filter(Boolean);

  const fingerprintSource = JSON.stringify({
    storyboardId,
    shot,
    story: storyNodes.map((node) => ({ id: node.id, text: node.data?.text })),
    characters: characterNodes.map((node) => ({ id: node.id, data: node.data })),
    scenes: sceneNodes.map((node) => ({ id: node.id, data: node.data })),
    continuityRules,
    referenceAssetIds: referenceAssets.map((asset) => asset.id),
  });

  return {
    id: `NV-${simpleHash(fingerprintSource).toUpperCase()}`,
    version: 1,
    ok: errors.length === 0,
    errors,
    warnings,
    storyboardId,
    shotId: shot?.id || null,
    shotIndex: shot?.index || null,
    shotTitle: normalizeText(shot?.title),
    duration: Number(shot?.duration || 5),
    aspectRatio: normalizeText(nodes.find((node) => node.id === storyboardId)?.data?.aspectRatio) || '16:9',
    prompt: promptSections.join('\n'),
    continuityRules,
    referenceAssets,
    sources: {
      stories: storyNodes.map((node) => normalizeText(node.data?.title)).filter(Boolean),
      characters: characterNodes.map((node) => normalizeText(node.data?.name)).filter(Boolean),
      scenes: sceneNodes.map((node) => normalizeText(node.data?.name)).filter(Boolean),
    },
  };
}
