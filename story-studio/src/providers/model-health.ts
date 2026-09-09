import type { ProviderHealth } from './contracts.js';

/** Probe metadata only, and only add /v1 to a bare origin after the root fails. */
export async function probeModelApi(input: { baseUrl: string; model: string; headers?: HeadersInit; fetchImpl?: typeof fetch }): Promise<{ health: ProviderHealth; resolvedBaseUrl?: string }> {
  const transport = input.fetchImpl ?? fetch;
  const original = new URL(input.baseUrl);
  const candidates = [input.baseUrl, ...(original.pathname === '/' ? [`${original.origin}/v1`] : [])];
  let last: ProviderHealth = { status: 'backend_offline', message: '模型查询未完成。', checkedAt: new Date().toISOString() };
  for (const baseUrl of candidates) {
    for (const suffix of [`/models/${encodeURIComponent(input.model)}`, '/models']) {
      const response = await transport(`${baseUrl}${suffix}`, { headers: input.headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const checkedAt = new Date().toISOString();
      if (response.ok) {
        const health = await modelMetadataHealth(response, input.model);
        if (health.status === 'ok' || health.status === 'model_missing') return { health, ...(health.status === 'ok' ? { resolvedBaseUrl: baseUrl } : {}) };
        last = { ...health, message: '服务已响应，但模型查询未返回有效模型数据；本次无法据此判断生成接口是否可用。' };
      } else {
        const status = response.status === 401 || response.status === 403 ? 'auth_error' : response.status === 429 ? 'rate_limited' : 'backend_offline';
        last = { status, message: response.status === 404 || response.status === 405 ? '服务未提供可用的模型查询接口，请核对服务地址；本次未验证生成能力。' : `模型查询返回 HTTP ${response.status}。`, checkedAt, details: { httpStatus: response.status } };
        if (![404, 405].includes(response.status)) return { health: last };
      }
    }
  }
  return { health: last };
}

/** A web page or unrelated JSON is not evidence that a model endpoint is available. */
export async function modelMetadataHealth(response: Response, model: string): Promise<ProviderHealth> {
  const checkedAt = new Date().toISOString();
  let payload: unknown;
  try { payload = await response.json(); } catch { /* Invalid metadata is reported below. */ }
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined;
  const ids = typeof record?.id === 'string' ? [record.id]
    : Array.isArray(record?.data) && record.data.every(item => item && typeof item === 'object' && typeof item.id === 'string')
      ? record.data.map(item => item.id as string) : undefined;
  if (!ids) return { status: 'backend_offline', message: '接口未返回有效模型数据，请检查 API 服务地址（包括 /v1 等路径）；本次未验证模型可用性。', checkedAt };
  if (!ids.includes(model)) return { status: 'model_missing', message: `服务返回的模型数据中没有 ${model}，请检查模型名。`, checkedAt };
  return { status: 'ok', message: `服务已返回模型 ${model} 的有效信息；实际生成权限尚未验证。`, checkedAt, details: { model } };
}
