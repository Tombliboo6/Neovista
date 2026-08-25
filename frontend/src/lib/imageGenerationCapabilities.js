const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const ALLOWED_RESOLUTION_SEMANTICS = new Set(['pixel_size', 'quality']);

const normalizeResolution = (resolution) => {
  const value = String(resolution?.value || '').trim();
  const label = String(resolution?.label || '').trim();
  const credits = Number(resolution?.credits);
  if (!value || !label || !Number.isFinite(credits) || credits < 0) return null;
  return Object.freeze({ value, label, credits });
};

const normalizeModel = (model) => {
  const id = String(model?.id || '').trim();
  const label = String(model?.label || '').trim();
  const providerModel = String(model?.provider_model || '').trim();
  const resolutionSemantics = String(model?.resolution_semantics || '').trim();
  const resolutions = Array.isArray(model?.resolutions)
    ? model.resolutions.map(normalizeResolution).filter(Boolean)
    : [];
  const aspectRatios = Array.isArray(model?.aspect_ratios)
    ? Array.from(new Set(model.aspect_ratios.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  if (
    !MODEL_ID_PATTERN.test(id)
    || !label
    || !providerModel
    || !ALLOWED_RESOLUTION_SEMANTICS.has(resolutionSemantics)
    || resolutions.length === 0
    || aspectRatios.length === 0
    || typeof model?.supports_reference_images !== 'boolean'
  ) {
    return null;
  }
  return Object.freeze({
    id,
    label,
    providerModel,
    resolutionSemantics,
    resolutions: Object.freeze(resolutions),
    aspectRatios: Object.freeze(aspectRatios),
    supportsReferenceImages: model.supports_reference_images,
  });
};

export function parseImageCapabilities(payload) {
  if (!payload || typeof payload.enabled !== 'boolean') {
    throw new Error('生图能力响应缺少 enabled');
  }
  if (payload.enabled === false) {
    return Object.freeze({
      enabled: false,
      disabledReason: String(payload.disabled_reason || '生图服务当前不可用'),
      defaultModel: null,
      maxNumImages: 1,
      models: Object.freeze([]),
    });
  }

  const models = Array.isArray(payload.models) ? payload.models.map(normalizeModel).filter(Boolean) : [];
  const defaultModel = String(payload.default_model || '').trim();
  const maxNumImages = Number(payload.max_num_images);
  if (
    models.length === 0
    || models.length !== payload.models.length
    || !models.some((model) => model.id === defaultModel)
    || !Number.isInteger(maxNumImages)
    || maxNumImages < 1
  ) {
    throw new Error('生图模型、价格或分辨率能力响应不完整');
  }
  return Object.freeze({
    enabled: true,
    disabledReason: null,
    defaultModel,
    maxNumImages,
    models: Object.freeze(models),
  });
}

export function getImageCapabilityModel(capabilities, modelId) {
  if (capabilities?.enabled !== true || !Array.isArray(capabilities.models)) return null;
  return capabilities.models.find((model) => model.id === modelId) || null;
}

export function normalizeImageResolution(capabilities, modelId, resolution) {
  const model = getImageCapabilityModel(capabilities, modelId);
  if (!model) return null;
  const requested = String(resolution || '').trim();
  return model.resolutions.some((option) => option.value === requested)
    ? requested
    : model.resolutions[0]?.value || null;
}

export function normalizeImageAspectRatio(capabilities, modelId, aspectRatio) {
  const model = getImageCapabilityModel(capabilities, modelId);
  if (!model) return null;
  const requested = String(aspectRatio || '').trim();
  return model.aspectRatios.includes(requested)
    ? requested
    : (model.aspectRatios.includes('auto') ? 'auto' : model.aspectRatios[0] || null);
}
