export async function fetchTemplatePromptPreview({
  templateId,
  token,
  userParams = '',
  parameters = null,
  customPromptStructure = null,
  generationMode = 'generate',
  fetchImpl = fetch,
} = {}) {
  const normalizedTemplateId = String(templateId || '').trim();
  if (!normalizedTemplateId) throw new Error('缺少模板 ID');

  const response = await fetchImpl(
    `/api/v1/templates/${encodeURIComponent(normalizedTemplateId)}/prompt-preview`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        user_params: userParams || null,
        parameters: parameters || null,
        custom_prompt_structure: customPromptStructure || null,
        generation_mode: generationMode,
      }),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `提示词加载失败 (${response.status})`);
  }

  return {
    effectivePrompt: String(data.effective_prompt || '').trim(),
    promptStructure: data.prompt_structure || null,
    templateId: data.template_id || normalizedTemplateId,
    templateName: data.template_name || '',
  };
}
