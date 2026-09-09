import type {
  AgentGenerationResult,
  AgentProvider,
  AgentRequest,
  AgentUsage,
  ProviderHealth,
  ProviderHealthStatus
} from './contracts.js';
import { TEXT_TOKEN_BUDGETS } from './token-budgets.ts';
import { generateText, jsonSchema, Output } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { StructuredOutputValidationError, executableOutputSchema, validateStructuredOutput } from './structured-output.ts';
import { boundedOutputBudget, normalizeTextCapabilities, returnedModelAllowed, type TextModelCapabilities } from './model-capabilities.ts';
import { readResponsesStream, ResponsesStreamError } from './responses-stream.ts';
import { modelMetadataHealth } from './model-health.ts';
import { normalizeStrictOutputSchema, strictOutputSchemaIssues } from './strict-output-schema.ts';

export type OpenAIReasoningEffort =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export type TextProviderProtocol =
  | 'auto'
  | 'responses'
  | 'chat-completions'
  | 'anthropic-messages';

export interface OpenAIResponsesProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  protocol?: TextProviderProtocol;
  reasoningEffort?: OpenAIReasoningEffort;
  timeoutMs?: number;
  transientRetryCount?: number;
  retryBaseDelayMs?: number;
  capabilities?: TextModelCapabilities;
}

export interface OpenAIResponsesTransientFailure {
  attempt: number;
  status: number;
  code?: string;
  externalTaskId?: string;
  elapsedMs: number;
  retryDelayMs: number;
}

export interface OpenAIResponsesErrorDiagnostics {
  externalTaskId?: string;
  operation?: string;
  targetKeys?: string[];
  requestedModel?: string;
  elapsedMs?: number;
  timeoutMs?: number;
  returnedModel?: string;
  responseStatus?: string;
  incompleteReason?: string;
  usage?: AgentUsage;
  rawOutputText?: string;
  outputItemSummary?: Array<{
    type?: string;
    contentTypes: string[];
  }>;
  attemptCount?: number;
  retryCount?: number;
  transientFailures?: OpenAIResponsesTransientFailure[];
  retryAfterMs?: number;
  stream?: { receivedBytes: number; eventCount: number; firstEventMs?: number; firstTextMs?: number };
  schemaIssues?: string[];
}

export class OpenAIResponsesProviderError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly diagnostics: OpenAIResponsesErrorDiagnostics | undefined;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      diagnostics?: OpenAIResponsesErrorDiagnostics;
    } = {}
  ) {
    super(message);
    this.name = 'OpenAIResponsesProviderError';
    this.status = options.status;
    this.code = options.code;
    this.diagnostics = options.diagnostics;
    Object.defineProperty(this, 'diagnostics', { enumerable: false });
  }
}

export class OpenAIResponsesAgentProvider implements AgentProvider {
  readonly id: string;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #protocol: Exclude<TextProviderProtocol, 'auto'>;
  readonly #reasoningEffort: OpenAIReasoningEffort;
  readonly #timeoutMs: number;
  readonly #transientRetryCount: number;
  readonly #retryBaseDelayMs: number;
  readonly #capabilities: TextModelCapabilities;

  constructor(options: OpenAIResponsesProviderOptions) {
    this.#apiKey = required(options.apiKey, 'OpenAI API key');
    this.#baseUrl = required(options.baseUrl, 'OpenAI base URL').replace(/\/$/, '');
    this.#model = required(options.model, 'OpenAI model');
    this.#protocol = resolveTextProviderProtocol(this.#baseUrl, this.#model, options.protocol);
    this.id = this.#protocol === 'responses'
      ? 'openai-responses'
      : this.#protocol === 'chat-completions'
        ? 'openai-chat-completions'
        : 'anthropic-messages';
    this.#reasoningEffort = options.reasoningEffort ?? 'high';
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#transientRetryCount = boundedInteger(options.transientRetryCount, 2, 0, 2);
    this.#retryBaseDelayMs = boundedInteger(options.retryBaseDelayMs, 1_000, 0, 8_000);
    this.#capabilities = normalizeTextCapabilities(options.capabilities);
  }

  static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    overrides: Partial<Pick<OpenAIResponsesProviderOptions, 'reasoningEffort' | 'timeoutMs' | 'transientRetryCount' | 'retryBaseDelayMs'>> = {}
  ): OpenAIResponsesAgentProvider {
    return new OpenAIResponsesAgentProvider({
      apiKey: environment.OPENAI_API_KEY ?? '',
      baseUrl: environment.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      model: environment.OPENAI_AGENT_MODEL ?? '',
      ...overrides
    });
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();

    try {
      const response = await fetch(`${this.#baseUrl}/models/${encodeURIComponent(this.#model)}`, {
        headers: textProviderHeaders(this.#protocol, this.#apiKey),
        signal: AbortSignal.timeout(Math.min(this.#timeoutMs, 30_000))
      });

      if (response.ok) {
        return modelMetadataHealth(response, this.#model);
      }

      return {
        status: healthStatusFor(response.status),
        message: `Model health check failed with HTTP ${response.status}.`,
        checkedAt,
        details: { model: this.#model, httpStatus: response.status }
      };
    } catch (error) {
      return {
        status: 'backend_offline',
        message: safeErrorMessage(error, this.#apiKey),
        checkedAt,
        details: { model: this.#model }
      };
    }
  }

  async generate<TOutput>(request: AgentRequest): Promise<AgentGenerationResult<TOutput>> {
    if (this.#protocol !== 'responses') return this.#generateCompatible<TOutput>(request);

    const startedAt = Date.now();
    const outputSchema = normalizeOpenAIStructuredOutputSchema(request.outputSchema);
    const schemaIssues = strictOutputSchemaIssues(outputSchema);
    if (schemaIssues.length) {
      throw new OpenAIResponsesProviderError(`本地结构化输出规则检查未通过：${schemaIssues.join('；')}`, {
        code: 'invalid_local_json_schema',
        diagnostics: { ...requestDiagnostics(request, this.#model, startedAt, 0, []), schemaIssues }
      });
    }
    const transientFailures: OpenAIResponsesTransientFailure[] = [];
    const payload = JSON.stringify({
      model: this.#model,
      stream: true,
      instructions: request.instructions,
      input: request.images?.length ? [{ role: 'user', content: [
        { type: 'input_text', text: JSON.stringify(request.input) },
        ...request.images.flatMap(image => [
          { type: 'input_text', text: `${image.id}: ${image.description}` },
          { type: 'input_image', image_url: `data:${image.mediaType};base64,${image.data}`, detail: 'high' }
        ])
      ] }] : JSON.stringify(request.input),
      reasoning: { effort: this.#reasoningEffort },
      max_output_tokens: boundedOutputBudget(request, this.#capabilities, TEXT_TOKEN_BUDGETS.formalDraft),
      text: {
        format: {
          type: 'json_schema',
          name: request.schemaName,
          strict: true,
          schema: outputSchema
        }
      }
    });
    let response: Response;
    let body: Record<string, unknown>;
    let attempt = 0;

    while (true) {
      attempt += 1;
      const attemptStartedAt = Date.now();
      const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
      try {
        response = await fetch(`${this.#baseUrl}/responses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            Accept: 'text/event-stream, application/json',
            'Content-Type': 'application/json'
          },
          body: payload,
          signal: timeoutSignal
        });
      } catch (error) {
        throw new OpenAIResponsesProviderError(safeErrorMessage(error, this.#apiKey), {
          code: timeoutSignal.aborted ? 'request_timeout' : 'network_error',
          diagnostics: {
            ...requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures),
            ...(timeoutSignal.aborted ? { timeoutMs: this.#timeoutMs } : {})
          }
        });
      }

      if (response.ok && response.headers?.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        try {
          body = await readResponsesStream(response, timeoutSignal, startedAt);
          break;
        } catch (error) {
          const stream = error instanceof ResponsesStreamError ? error.diagnostics : undefined;
          const envelope = stream?.response, rawOutputText = stream?.rawOutputText;
          const diagnostics: OpenAIResponsesErrorDiagnostics = {
            ...(envelope ? responseDiagnostics(envelope, this.#apiKey) : {}),
            ...requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures),
            ...(stream ? { stream: { receivedBytes: stream.receivedBytes, eventCount: stream.eventCount, ...(stream.firstEventMs !== undefined ? { firstEventMs: stream.firstEventMs } : {}), ...(stream.firstTextMs !== undefined ? { firstTextMs: stream.firstTextMs } : {}) }, ...(rawOutputText ? { rawOutputText: redact(rawOutputText, this.#apiKey) } : {}) } : {}),
            ...(timeoutSignal.aborted ? { timeoutMs: this.#timeoutMs } : {})
          };
          const gatewayRequestId = response.headers.get('x-request-id') || response.headers.get('request-id');
          if (!diagnostics.externalTaskId && gatewayRequestId) diagnostics.externalTaskId = gatewayRequestId;
          throw new OpenAIResponsesProviderError(safeErrorMessage(error, this.#apiKey), {
            status: response.status,
            code: error instanceof ResponsesStreamError ? error.code : 'response_body_read_error',
            diagnostics
          });
        }
      }

      let rawBody: string;
      try {
        rawBody = await response.text();
      } catch (error) {
        const errorName = error instanceof DOMException ? error.name : error instanceof Error ? error.name : '';
        const timedOut = errorName === 'TimeoutError' || errorName === 'AbortError';
        throw new OpenAIResponsesProviderError(safeErrorMessage(error, this.#apiKey), {
          status: response.status,
          code: timedOut ? 'response_body_timeout' : 'response_body_read_error',
          diagnostics: {
            ...requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures),
            ...(timedOut ? { timeoutMs: this.#timeoutMs } : {})
          }
        });
      }
      try {
        body = parseJsonObject(rawBody);
      } catch (error) {
        if (isRecoverableGatewayFailure(response.status, undefined) && attempt <= this.#transientRetryCount) {
          const retryDelayMs = retryDelay(response.headers.get('retry-after'), this.#retryBaseDelayMs, attempt);
          const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined;
          transientFailures.push({
            attempt,
            status: response.status,
            ...(requestId ? { externalTaskId: requestId } : {}),
            elapsedMs: Date.now() - attemptStartedAt,
            retryDelayMs
          });
          if (retryDelayMs > 0) await delay(retryDelayMs);
          continue;
        }
        if (error instanceof OpenAIResponsesProviderError) {
          throw new OpenAIResponsesProviderError(error.message, {
            status: response.status,
            ...(error.code ? { code: error.code } : {}),
            diagnostics: requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures)
          });
        }
        throw error;
      }

      if (response.ok) break;

      const error = objectAt(body, 'error');
      const code = stringAt(error, 'code') ?? stringAt(error, 'type');
      const requestId = stringAt(body, 'request_id')
        ?? (error ? stringAt(error, 'request_id') : undefined)
        ?? response.headers.get('x-request-id')
        ?? response.headers.get('request-id')
        ?? undefined;
      const canRecover = isRecoverableGatewayFailure(response.status, code)
        && attempt <= this.#transientRetryCount;

      if (canRecover) {
        const retryDelayMs = retryDelay(response.headers.get('retry-after'), this.#retryBaseDelayMs, attempt);
        transientFailures.push({
          attempt,
          status: response.status,
          ...(code ? { code } : {}),
          ...(requestId ? { externalTaskId: requestId } : {}),
          elapsedMs: Date.now() - attemptStartedAt,
          retryDelayMs
        });
        if (retryDelayMs > 0) await delay(retryDelayMs);
        continue;
      }

      const message = stringAt(error, 'message') ?? `Responses API failed with HTTP ${response.status}.`;
      const diagnostics = {
        ...responseDiagnostics(body, this.#apiKey),
        ...requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures)
      };
      if (!diagnostics.externalTaskId && requestId) diagnostics.externalTaskId = requestId;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) diagnostics.retryAfterMs = Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
      throw new OpenAIResponsesProviderError(redact(message, this.#apiKey), {
        status: response.status,
        ...(code ? { code } : {}),
        diagnostics
      });
    }

    const responseStatus = stringAt(body, 'status');

    if (responseStatus !== 'completed') {
      const diagnostics = {
        ...responseDiagnostics(body, this.#apiKey),
        ...requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures)
      };
      const incompleteDetails = objectAt(body, 'incomplete_details');
      const incompleteReason = stringAt(incompleteDetails, 'reason');
      if (responseStatus) diagnostics.responseStatus = responseStatus;
      if (incompleteReason) diagnostics.incompleteReason = incompleteReason;

      throw new OpenAIResponsesProviderError(
        `Responses API returned non-completed status: ${responseStatus ?? 'unknown'}${
          incompleteReason ? ` (${incompleteReason})` : ''
        }.`,
        { status: response.status, code: 'incomplete_response', diagnostics }
      );
    }

    const externalTaskId = stringAt(body, 'id');
    const returnedModel = stringAt(body, 'model') ?? this.#model;
    const usage = usageFrom(body);
    let outputText: string;
    try {
      outputText = extractOutputText(body, response.status, this.#apiKey);
    } catch (error) {
      if (error instanceof OpenAIResponsesProviderError) {
        throw new OpenAIResponsesProviderError(error.message, {
          ...(error.status !== undefined ? { status: error.status } : {}),
          ...(error.code ? { code: error.code } : {}),
          diagnostics: {
            ...(error.diagnostics ?? {}),
            ...requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures)
          }
        });
      }
      throw error;
    }
    let output: TOutput;

    try {
      output = parseStructuredOutput<TOutput>(outputText);
      validateStructuredOutput(output, request.outputSchema);
    } catch (error) {
      const diagnostics = {
        ...responseDiagnostics(body, this.#apiKey),
        ...requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures)
      };

      throw new OpenAIResponsesProviderError(error instanceof StructuredOutputValidationError ? error.message : 'Structured model output was not valid JSON.', {
        status: response.status,
        code: error instanceof StructuredOutputValidationError ? 'schema_validation_failed' : 'invalid_structured_output',
        diagnostics
      });
    }

    if (!returnedModelAllowed(this.#model, returnedModel, this.#capabilities)) {
      throw new OpenAIResponsesProviderError(
        `Router returned model ${returnedModel} instead of requested model ${this.#model}.`,
        {
          status: response.status,
          code: 'model_mismatch',
          diagnostics: requestDiagnostics(request, this.#model, startedAt, attempt, transientFailures)
        }
      );
    }

    const result: AgentGenerationResult<TOutput> = {
      output,
      providerId: this.id,
      model: returnedModel,
      status: 'completed',
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt
    };

    if (externalTaskId) result.externalTaskId = externalTaskId;
    if (usage) result.usage = usage;
    if (transientFailures.length > 0) {
      result.recovery = {
        attemptCount: attempt,
        retryCount: transientFailures.length,
        recoveredAfterTransientFailure: true,
        transientFailures: transientFailures.map((item) => ({ ...item }))
      };
    }

    return result;
  }

  async #generateCompatible<TOutput>(request: AgentRequest): Promise<AgentGenerationResult<TOutput>> {
    const startedAt = Date.now();
    const instructions = compatibleStructuredInstructions(request);
    const maxTokens = boundedOutputBudget(request, this.#capabilities, TEXT_TOKEN_BUDGETS.formalDraft);
    const anthropic = this.#protocol === 'anthropic-messages';
    let capturedBody = '', capturedHeaders: Record<string, string> = {}, capturedStatus: number | undefined;
    let capture: Promise<void> = Promise.resolve();
    const transport: typeof fetch = async (url, init) => {
      const response = await globalThis.fetch(url, init);
      capturedStatus = response.status; capturedHeaders = Object.fromEntries(response.headers.entries());
      capture = response.clone().text().then(body => { capturedBody = body.slice(0, 4_000_000); }).catch(() => {});
      return response;
    };
    const model = anthropic
      ? createAnthropic({
          apiKey: this.#apiKey,
          baseURL: this.#baseUrl,
          fetch: transport
        })(this.#model)
      : createOpenAICompatible({
          name: 'prism-openai-compatible',
          apiKey: this.#apiKey,
          baseURL: this.#baseUrl,
          fetch: transport,
          // DeepSeek, Kimi and GLM accept json_object. The SDK validates the
          // complete domain JSON Schema locally after the provider responds.
          supportsStructuredOutputs: false
        }).chatModel(this.#model);

    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const generated = await generateText({
        model,
        system: instructions,
        ...(request.images?.length ? { messages: [{ role: 'user' as const, content: [
          { type: 'text' as const, text: JSON.stringify(request.input) },
          ...request.images.flatMap(image => [
            { type: 'text' as const, text: `${image.id}: ${image.description}` },
            { type: 'image' as const, image: image.data, mediaType: image.mediaType }
          ])
        ] }] } : { prompt: JSON.stringify(request.input) }),
        output: Output.object({
          name: request.schemaName,
          schema: jsonSchema<TOutput>(normalizeOpenAIStructuredOutputSchema(request.outputSchema), executableOutputSchema<TOutput>(request.outputSchema))
        }),
        maxOutputTokens: maxTokens,
        maxRetries: 0,
        abortSignal: timeoutSignal
      });
      const returnedModel = generated.response.modelId || this.#model;
      const diagnostics = requestDiagnostics(request, this.#model, startedAt, 1, []);
      diagnostics.returnedModel = returnedModel;
      const externalTaskId = generated.response.id
        ?? generated.response.headers?.['x-request-id']
        ?? generated.response.headers?.['request-id'];
      if (externalTaskId) diagnostics.externalTaskId = externalTaskId;
      const usage = aiSdkUsage(generated.usage);
      if (usage) diagnostics.usage = usage;
      if (generated.finishReason === 'length' || generated.finishReason === 'content-filter') {
        throw new OpenAIResponsesProviderError('文字响应未完整结束。', { code: 'incomplete_response', diagnostics: { ...diagnostics, incompleteReason: generated.finishReason } });
      }
      if (!returnedModelAllowed(this.#model, returnedModel, this.#capabilities)) {
        throw new OpenAIResponsesProviderError(
          `Router returned model ${returnedModel} instead of requested model ${this.#model}.`,
          { code: 'model_mismatch', diagnostics }
        );
      }
      const result: AgentGenerationResult<TOutput> = {
        output: generated.output,
        providerId: this.id,
        model: returnedModel,
        status: 'completed',
        completedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt
      };
      if (externalTaskId) result.externalTaskId = externalTaskId;
      if (usage) result.usage = usage;
      return result;
    } catch (error) {
      await capture;
      const failure = error instanceof OpenAIResponsesProviderError ? error : compatibleAiSdkError(error, request, this.#model, this.#apiKey, startedAt);
      const diagnostics = { ...failure.diagnostics };
      if (timeoutSignal.aborted) diagnostics.timeoutMs = this.#timeoutMs;
      let code = timeoutSignal.aborted ? 'request_timeout' : failure.code, message = failure.message;
      if (capturedBody) {
        let body: Record<string, unknown> | undefined;
        try { body = JSON.parse(capturedBody); } catch { /* Keep the transport failure when the envelope is unreadable. */ }
        if (body) {
          const text = compatibleOutputText(body, this.#protocol);
          diagnostics.externalTaskId ||= stringAt(body, 'id');
          diagnostics.returnedModel = stringAt(body, 'model');
          if (text !== undefined) diagnostics.rawOutputText = redact(text, this.#apiKey);
          const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
          const finish = anthropic ? stringAt(body, 'stop_reason') : stringAt(choice, 'finish_reason');
          diagnostics.responseStatus = finish;
          diagnostics.outputItemSummary = anthropic
            ? (Array.isArray(body.content) ? body.content.map(item => ({ type: 'message', contentTypes: [String(item?.type || 'unknown')] })) : [])
            : [{ type: 'message', contentTypes: [text?.trim() ? 'text' : 'empty_text', ...(choice?.message?.reasoning_content ? ['reasoning'] : [])] }];
          diagnostics.usage = compatibleUsageFrom(body);
          if (capturedStatus === 200 && ['invalid_structured_output', 'incomplete_response'].includes(code ?? '')) {
            if (['length', 'max_tokens', 'content_filter', 'refusal'].includes(finish ?? '') || code === 'incomplete_response') {
              code = 'incomplete_response'; diagnostics.incompleteReason = finish ?? diagnostics.incompleteReason;
              message = '文字响应被截断或未完整结束，已保留实际返回正文。';
            } else if (!text?.trim()) {
              code = 'missing_output_text'; message = '文字服务没有返回可用的最终正文。';
            } else {
              // Re-read this same response locally; never submit a formatting retry.
              try {
                const output = parseStructuredOutput<TOutput>(text);
                validateStructuredOutput(output, request.outputSchema);
                const returnedModel = diagnostics.returnedModel || this.#model;
                if (!returnedModelAllowed(this.#model, returnedModel, this.#capabilities)) {
                  code = 'model_mismatch'; message = `Router returned model ${returnedModel} instead of requested model ${this.#model}.`;
                } else {
                  return { output, providerId: this.id, model: returnedModel, status: 'completed', completedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, ...(diagnostics.externalTaskId ? { externalTaskId: diagnostics.externalTaskId } : {}), ...(diagnostics.usage ? { usage: diagnostics.usage } : {}) };
                }
              } catch (parseError) {
                code = parseError instanceof StructuredOutputValidationError ? 'schema_validation_failed' : 'invalid_structured_output';
                message = parseError instanceof Error ? parseError.message : '最终正文无法解析。';
              }
            }
          }
        }
      }
      const retryAfter = capturedHeaders['retry-after'];
      if (retryAfter) diagnostics.retryAfterMs = Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
      diagnostics.externalTaskId ||= capturedHeaders['x-request-id'] || capturedHeaders['request-id'];
      throw new OpenAIResponsesProviderError(redact(message, this.#apiKey), { ...(capturedStatus !== undefined ? { status: capturedStatus } : {}), ...(code ? { code } : {}), diagnostics });
    }
  }
}

export function resolveTextProviderProtocol(
  baseUrl: string,
  model: string,
  configured: TextProviderProtocol = 'auto'
): Exclude<TextProviderProtocol, 'auto'> {
  if (configured !== 'auto') return configured;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return 'responses';
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (/\/anthropic(?:\/|$)/u.test(path) || host === 'api.anthropic.com') return 'anthropic-messages';
  if (host === 'api.openai.com') return 'responses';
  if (
    host === 'api.deepseek.com'
    || host === 'api.moonshot.cn'
    || host === 'open.bigmodel.cn'
    || host === 'dashscope.aliyuncs.com'
  ) return 'chat-completions';
  if (/^(?:deepseek|kimi|moonshot|glm|qwen|claude)[-_.]/iu.test(model)) return 'chat-completions';
  return 'responses';
}

function textProviderHeaders(
  protocol: Exclude<TextProviderProtocol, 'auto'>,
  apiKey: string
): Record<string, string> {
  if (protocol === 'anthropic-messages') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    };
  }
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

function compatibleStructuredInstructions(request: AgentRequest): string {
  const schema = normalizeOpenAIStructuredOutputSchema(request.outputSchema);
  return [
    request.instructions,
    '\u8fd4\u56de\u5185\u5bb9\u5fc5\u987b\u662f\u4e00\u4e2a\u5b8c\u6574\u7684 JSON \u503c\uff0c\u4e0d\u8981\u4f7f\u7528 Markdown \u4ee3\u7801\u5757\uff0c\u4e0d\u8981\u5728 JSON \u524d\u540e\u6dfb\u52a0\u89e3\u91ca\u3002',
    `JSON Schema\uff1a${JSON.stringify(schema)}`
  ].join('\n\n');
}

function compatibleOutputText(
  body: Record<string, unknown>,
  protocol: Exclude<TextProviderProtocol, 'auto'>
): string | undefined {
  if (protocol === 'anthropic-messages') {
    const content = body.content;
    if (!Array.isArray(content)) return undefined;
    const text = content
      .filter(isObject)
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => String(item.text))
      .join('');
    return text || undefined;
  }
  const choices = body.choices;
  if (!Array.isArray(choices) || !isObject(choices[0])) return undefined;
  const message = objectAt(choices[0], 'message');
  if (!message) return undefined;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return undefined;
  const text = message.content
    .filter(isObject)
    .filter((item) => (item.type === 'text' || item.type === 'output_text') && typeof item.text === 'string')
    .map((item) => String(item.text))
    .join('');
  return text || undefined;
}

function compatibleIncompleteReason(
  body: Record<string, unknown>,
  protocol: Exclude<TextProviderProtocol, 'auto'>
): string | undefined {
  if (protocol === 'anthropic-messages') {
    return stringAt(body, 'stop_reason') === 'max_tokens' ? 'max_tokens' : undefined;
  }
  const choices = body.choices;
  const first = Array.isArray(choices) && isObject(choices[0]) ? choices[0] : undefined;
  return stringAt(first, 'finish_reason') === 'length' ? 'max_tokens' : undefined;
}

function compatibleResponseDiagnostics(
  body: Record<string, unknown>,
  protocol: Exclude<TextProviderProtocol, 'auto'>,
  apiKey: string
): OpenAIResponsesErrorDiagnostics {
  const diagnostics: OpenAIResponsesErrorDiagnostics = {};
  const externalTaskId = stringAt(body, 'id');
  const returnedModel = stringAt(body, 'model');
  const usage = compatibleUsageFrom(body);
  const outputText = compatibleOutputText(body, protocol);
  if (externalTaskId) diagnostics.externalTaskId = externalTaskId;
  if (returnedModel) diagnostics.returnedModel = returnedModel;
  if (usage) diagnostics.usage = usage;
  if (outputText !== undefined) diagnostics.rawOutputText = redact(outputText, apiKey);
  return diagnostics;
}

function compatibleUsageFrom(body: Record<string, unknown>): AgentUsage | undefined {
  const usage = objectAt(body, 'usage');
  if (!usage) return undefined;
  const inputTokens = numberAt(usage, 'prompt_tokens') ?? numberAt(usage, 'input_tokens');
  const outputTokens = numberAt(usage, 'completion_tokens') ?? numberAt(usage, 'output_tokens');
  const reportedTotalTokens = numberAt(usage, 'total_tokens');
  const result: AgentUsage = {};
  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (reportedTotalTokens !== undefined) result.reportedTotalTokens = reportedTotalTokens;
  if (inputTokens !== undefined && outputTokens !== undefined) {
    result.calculatedTotalTokens = inputTokens + outputTokens;
    if (reportedTotalTokens !== undefined) result.accountingConsistent = reportedTotalTokens === result.calculatedTotalTokens;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function aiSdkUsage(value: unknown): AgentUsage | undefined {
  if (!isObject(value)) return undefined;
  const inputTokens = numberAt(value, 'inputTokens');
  const outputTokens = numberAt(value, 'outputTokens');
  const reportedTotalTokens = numberAt(value, 'totalTokens');
  const outputDetails = objectAt(value, 'outputTokenDetails');
  const reasoningTokens = numberAt(outputDetails, 'reasoningTokens');
  const result: AgentUsage = {};
  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  if (reportedTotalTokens !== undefined) result.reportedTotalTokens = reportedTotalTokens;
  if (inputTokens !== undefined && outputTokens !== undefined) {
    result.calculatedTotalTokens = inputTokens + outputTokens;
    if (reportedTotalTokens !== undefined) result.accountingConsistent = reportedTotalTokens === result.calculatedTotalTokens;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function compatibleAiSdkError(
  error: unknown,
  request: AgentRequest,
  model: string,
  apiKey: string,
  startedAt: number
): OpenAIResponsesProviderError {
  const value = isObject(error) ? error : {};
  const cause = objectAt(value, 'cause');
  const status = numberAt(value, 'statusCode') ?? numberAt(cause, 'statusCode');
  const responseHeaders = objectAt(value, 'responseHeaders') ?? objectAt(cause, 'responseHeaders');
  const responseBody = typeof value.responseBody === 'string'
    ? value.responseBody
    : typeof cause?.responseBody === 'string'
      ? cause.responseBody
      : undefined;
  const data = objectAt(value, 'data') ?? objectAt(cause, 'data');
  const providerError = objectAt(data, 'error');
  const externalTaskId = stringAt(responseHeaders, 'x-request-id')
    ?? stringAt(responseHeaders, 'request-id');
  const rawOutputText = typeof cause?.text === 'string'
    ? cause.text
    : typeof value.text === 'string'
      ? value.text
      : undefined;
  const diagnostics = requestDiagnostics(request, model, startedAt, 1, []);
  if (externalTaskId) diagnostics.externalTaskId = externalTaskId;
  if (rawOutputText) diagnostics.rawOutputText = redact(rawOutputText, apiKey);
  const errorName = typeof value.name === 'string' ? value.name : '';
  const causeName = typeof cause?.name === 'string' ? cause.name : '';
  const providerCode = stringAt(providerError, 'code') ?? stringAt(providerError, 'type');
  const structuredFailure = /NoObjectGenerated|NoOutputGenerated|JSONParse|TypeValidation/u.test(`${errorName} ${causeName}`);
  const timeoutFailure = /Timeout|Abort/u.test(`${errorName} ${causeName}`);
  const code = providerCode
    ?? (structuredFailure ? 'invalid_structured_output' : timeoutFailure ? 'network_error' : status ? 'api_call_error' : 'network_error');
  const fallbackMessage = structuredFailure
    ? 'Structured model output did not match the required JSON schema.'
    : 'Text API request failed.';
  const message = stringAt(providerError, 'message')
    ?? (error instanceof Error ? error.message : fallbackMessage);
  if (responseBody && !diagnostics.rawOutputText && status !== undefined) {
    diagnostics.rawOutputText = redact(responseBody, apiKey);
  }
  return new OpenAIResponsesProviderError(redact(message || fallbackMessage, apiKey), {
    ...(status !== undefined ? { status } : {}),
    code,
    diagnostics
  });
}

function requestDiagnostics(
  request: AgentRequest,
  model: string,
  startedAt: number,
  attemptCount: number,
  transientFailures: OpenAIResponsesTransientFailure[]
): OpenAIResponsesErrorDiagnostics {
  return {
    operation: request.operation,
    targetKeys: collectStableTargetKeys(request.input, request.operation),
    requestedModel: model,
    elapsedMs: Date.now() - startedAt,
    attemptCount,
    retryCount: transientFailures.length,
    ...(transientFailures.length > 0
      ? { transientFailures: transientFailures.map((item) => ({ ...item })) }
      : {})
  };
}

function isRecoverableGatewayFailure(status: number, code: string | undefined): boolean {
  return status === 502 || status === 503 || status === 504
    || (status >= 500 && /(?:upstream|gateway|temporar)/iu.test(code ?? ''));
}

function retryDelay(retryAfter: string | null, baseDelayMs: number, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1_000), 8_000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(Math.max(0, retryAt - Date.now()), 8_000);
  }
  return Math.min(baseDelayMs * (2 ** Math.max(0, attempt - 1)), 8_000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(Number(value))));
}

export function parseStructuredOutput<TOutput>(outputText: string): TOutput {
  const trimmed = outputText.trim().replace(/^\uFEFF/, '');
  const candidates = [trimmed];
  const fenced = unwrapSingleJsonFence(trimmed);

  if (fenced !== undefined && fenced !== trimmed) {
    candidates.push(fenced);
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as TOutput;
    } catch {
      const repaired = repairConservativeStructuredJson(candidate);
      if (repaired !== undefined) {
        try {
          return JSON.parse(repaired) as TOutput;
        } catch {
          // The local repair is accepted only when it produces complete JSON.
        }
      }
    }
  }

  const embedded = extractUniqueEmbeddedJsonContainer(trimmed);
  if (embedded !== undefined) return embedded as TOutput;

  throw new SyntaxError('Structured output is not valid JSON.');
}

function repairConservativeStructuredJson(value: string): string | undefined {
  const boundaryRepaired = value.replace(/\]\s*\}\s*,\s*"decisionBasis"\s*:/gu, '],"decisionBasis":');
  const rootEnd = completeJsonRootEnd(boundaryRepaired);
  if (rootEnd === undefined) return undefined;
  const trailing = boundaryRepaired.slice(rootEnd + 1);
  if (trailing && !/^[\s}\]]+$/u.test(trailing)) return undefined;
  const repaired = boundaryRepaired.slice(0, rootEnd + 1);
  return repaired !== value ? repaired : undefined;
}

function completeJsonRootEnd(value: string): number | undefined {
  const first = value.search(/\S/u);
  if (first < 0 || (value[first] !== '{' && value[first] !== '[')) return undefined;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = first; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '{' || character === '[') { stack.push(character); continue; }
    if (character !== '}' && character !== ']') continue;
    const expected = character === '}' ? '{' : '[';
    if (stack.at(-1) !== expected) return undefined;
    stack.pop();
    if (stack.length === 0) return index;
  }
  return undefined;
}

function extractUniqueEmbeddedJsonContainer(value: string): unknown | undefined {
  const parsedCandidates: unknown[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const opening = value[index];
    if (opening !== '{' && opening !== '[') continue;

    const end = findJsonContainerEnd(value, index);
    if (end === undefined) continue;

    const candidate = value.slice(index, end + 1);
    try {
      parsedCandidates.push(JSON.parse(candidate));
    } catch {
      // A balanced-looking prose fragment is not treated as structured data.
    }
    index = end;
  }

  return parsedCandidates.length === 1 ? parsedCandidates[0] : undefined;
}

function findJsonContainerEnd(value: string, start: number): number | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      stack.push(character);
      continue;
    }
    if (character !== '}' && character !== ']') continue;

    const expectedOpening = character === '}' ? '{' : '[';
    if (stack.pop() !== expectedOpening) return index;
    if (stack.length === 0) return index;
  }

  return undefined;
}

function unwrapSingleJsonFence(value: string): string | undefined {
  const match = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/iu.exec(value);
  return match?.[1]?.trim();
}

function extractOutputText(
  body: Record<string, unknown>,
  httpStatus: number,
  apiKey: string
): string {
  const output = body.output;
  if (!Array.isArray(output)) {
    throw new OpenAIResponsesProviderError('Responses API result did not contain output items.', {
      status: httpStatus,
      code: 'missing_output',
      diagnostics: responseDiagnostics(body, apiKey)
    });
  }

  const outputText = outputTextFrom(body);
  if (outputText !== undefined) return outputText;

  throw new OpenAIResponsesProviderError('Responses API result did not contain output text.', {
    status: httpStatus,
    code: 'missing_output_text',
    diagnostics: responseDiagnostics(body, apiKey)
  });
}

function outputTextFrom(body: Record<string, unknown>): string | undefined {
  const output = body.output;
  if (!Array.isArray(output)) return undefined;

  for (const item of output) {
    if (!isObject(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isObject(content) && content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }

  return undefined;
}

export function normalizeOpenAIStructuredOutputSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  return normalizeStrictOutputSchema(schema);
}

function responseDiagnostics(
  body: Record<string, unknown>,
  apiKey: string
): OpenAIResponsesErrorDiagnostics {
  const diagnostics: OpenAIResponsesErrorDiagnostics = {};
  const externalTaskId = stringAt(body, 'id');
  const returnedModel = stringAt(body, 'model');
  const responseStatus = stringAt(body, 'status');
  const usage = usageFrom(body);
  const outputText = outputTextFrom(body);
  const outputItemSummary = summarizeOutputItems(body);

  if (externalTaskId) diagnostics.externalTaskId = externalTaskId;
  if (returnedModel) diagnostics.returnedModel = returnedModel;
  if (responseStatus) diagnostics.responseStatus = responseStatus;
  if (usage) diagnostics.usage = usage;
  if (outputText !== undefined) diagnostics.rawOutputText = redact(outputText, apiKey);
  if (outputItemSummary.length > 0) diagnostics.outputItemSummary = outputItemSummary;

  return diagnostics;
}

function collectStableTargetKeys(value: unknown, operation: string): string[] {
  const keys: string[] = [];
  const targetPattern = /storyboard|video-prompt|segment-video/iu.test(operation)
    ? /^SEG\d{3}$/u
    : /character/iu.test(operation)
      ? /^C\d{2,3}$/u
      : /scene/iu.test(operation)
        ? /^L\d{2,3}$/u
        : /prop/iu.test(operation)
          ? /^R\d{2,3}$/u
          : /^(?:SEG\d{3}|C\d{2,3}|L\d{2,3}|R\d{2,3})$/u;
  const seen = new Set<unknown>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 8 || keys.length >= 24 || candidate === null || candidate === undefined) return;
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toUpperCase();
      if (targetPattern.test(normalized) && !keys.includes(normalized)) keys.push(normalized);
      return;
    }
    if (typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.values(candidate as Record<string, unknown>).forEach((item) => visit(item, depth + 1));
  };
  visit(value, 0);
  return keys;
}

function summarizeOutputItems(
  body: Record<string, unknown>
): Array<{ type?: string; contentTypes: string[] }> {
  const output = body.output;
  if (!Array.isArray(output)) return [];

  return output.map((item) => {
    if (!isObject(item)) return { contentTypes: [] };
    const contentTypes = Array.isArray(item.content)
      ? item.content
          .map((content) => (isObject(content) ? stringAt(content, 'type') : undefined))
          .filter((type): type is string => type !== undefined)
      : [];
    const type = stringAt(item, 'type');
    return type ? { type, contentTypes } : { contentTypes };
  });
}

function usageFrom(body: Record<string, unknown>): AgentUsage | undefined {
  const usage = objectAt(body, 'usage');
  if (!usage) return undefined;

  const inputTokens = numberAt(usage, 'input_tokens');
  const outputTokens = numberAt(usage, 'output_tokens');
  const reportedTotalTokens = numberAt(usage, 'total_tokens');
  const outputDetails = objectAt(usage, 'output_tokens_details');
  const reasoningTokens = outputDetails ? numberAt(outputDetails, 'reasoning_tokens') : undefined;
  const calculatedTotalTokens =
    inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined;
  const result: AgentUsage = {};

  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  if (reportedTotalTokens !== undefined) result.reportedTotalTokens = reportedTotalTokens;
  if (calculatedTotalTokens !== undefined) result.calculatedTotalTokens = calculatedTotalTokens;
  if (reportedTotalTokens !== undefined && calculatedTotalTokens !== undefined) {
    result.accountingConsistent = reportedTotalTokens === calculatedTotalTokens;
  }

  return result;
}

function parseJsonObject(rawBody: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (isObject(parsed)) return parsed;
  } catch {
    // Converted to a stable provider error below.
  }

  throw new OpenAIResponsesProviderError('Responses API returned a non-JSON response.', {
    code: 'invalid_response_body'
  });
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function healthStatusFor(status: number): ProviderHealthStatus {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 404) return 'model_missing';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'backend_offline';
  return 'down';
}

function safeErrorMessage(error: unknown, apiKey: string): string {
  return redact(error instanceof Error ? error.message : 'Unknown provider error.', apiKey);
}

function redact(value: string, secret: string): string {
  return secret ? value.replaceAll(secret, '[REDACTED]') : value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(
  value: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const nested = value?.[key];
  return isObject(nested) ? nested : undefined;
}

function stringAt(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const nested = value?.[key];
  return typeof nested === 'string' ? nested : undefined;
}

function numberAt(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const nested = value?.[key];
  return typeof nested === 'number' ? nested : undefined;
}
