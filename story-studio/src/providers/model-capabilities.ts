import type { AgentRequest } from './contracts.js';

export interface TextModelCapabilities {
  maxOutputTokens?: number;
  contextWindowTokens?: number;
  allowedReturnedModels?: string[];
}

export function normalizeTextCapabilities(value: unknown): TextModelCapabilities {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const integer = (key: string) => {
    if (source[key] === undefined || source[key] === '' || source[key] === null) return undefined;
    const number = Number(source[key]);
    if (!Number.isInteger(number) || number < 256 || number > 4_000_000) throw new Error(`${key} 必须为 256 至 4000000 的整数。`);
    return number;
  };
  const aliases = Array.isArray(source.allowedReturnedModels) ? source.allowedReturnedModels : typeof source.allowedReturnedModels === 'string' ? source.allowedReturnedModels.split(/[\n,，]/u) : [];
  return {
    maxOutputTokens: integer('maxOutputTokens'), contextWindowTokens: integer('contextWindowTokens'),
    allowedReturnedModels: [...new Set(aliases.map(String).map(x => x.trim()).filter(Boolean))].slice(0, 30),
  };
}

export function boundedOutputBudget(request: AgentRequest, capabilities: TextModelCapabilities, fallback: number): number {
  let budget = Math.min(request.maxOutputTokens ?? fallback, capabilities.maxOutputTokens ?? Infinity);
  if (capabilities.contextWindowTokens) {
    // UTF-8 bytes provide a conservative local estimate, not a provider token count.
    const estimatedInput = Buffer.byteLength(`${request.instructions}\n${JSON.stringify(request.input)}\n${JSON.stringify(request.outputSchema)}`, 'utf8') + 512;
    budget = Math.min(budget, capabilities.contextWindowTokens - estimatedInput);
  }
  if (budget < 256) throw new Error('当前输入已接近模型上下文上限，请减少本次处理范围或核对模型能力设置。');
  return Math.floor(budget);
}

export function returnedModelAllowed(requested: string, returned: string, capabilities: TextModelCapabilities): boolean {
  return returned === requested || (capabilities.allowedReturnedModels ?? []).includes(returned);
}
