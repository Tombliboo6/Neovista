type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const MAX_STREAM_BYTES = 32 * 1024 * 1024;
const MAX_EVENT_CHARACTERS = 4 * 1024 * 1024;
const MAX_DIAGNOSTIC_CHARACTERS = 2 * 1024 * 1024;

export interface ResponsesStreamDiagnostics {
  response?: JsonObject;
  rawOutputText: string;
  receivedBytes: number;
  eventCount: number;
  firstEventMs?: number;
  firstTextMs?: number;
}

export class ResponsesStreamError extends Error {
  readonly code: string;
  readonly diagnostics: ResponsesStreamDiagnostics;
  constructor(message: string, code: string, diagnostics: ResponsesStreamDiagnostics) {
    super(message);
    this.name = 'ResponsesStreamError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

/** A completed response envelope is the only success boundary; deltas are diagnostic drafts. */
export async function readResponsesStream(response: Response, signal: AbortSignal, startedAt: number): Promise<JsonObject> {
  const diagnostics: ResponsesStreamDiagnostics = { rawOutputText: '', receivedBytes: 0, eventCount: 0 };
  const parts = new Map<string, string>();
  const snapshot = () => ({ ...diagnostics, rawOutputText: [...parts.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([, value]) => value).join('').slice(0, MAX_DIAGNOSTIC_CHARACTERS) });
  const fail = (message: string, code: string): never => { throw new ResponsesStreamError(message, code, snapshot()); };
  if (!response.body) return fail('文字流式响应没有可读取的数据流。', 'stream_incomplete');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', dataLines: string[] = [], eventName = '', eventCharacters = 0;
  let terminal: JsonObject | undefined;
  const receiveText = (event: JsonObject, value: string, append: boolean) => {
    const key = `${Number(event.output_index) || 0}:${Number(event.content_index) || 0}`;
    if (!parts.has(key) && parts.size >= 128) return fail('文字流式响应包含过多输出项。', 'stream_response_too_large');
    const next = append ? (parts.get(key) || '') + value : value;
    if (next.length > MAX_DIAGNOSTIC_CHARACTERS) return fail('文字流式正文超过本地接收范围。', 'stream_response_too_large');
    parts.set(key, next);
    if (value && diagnostics.firstTextMs === undefined) diagnostics.firstTextMs = Date.now() - startedAt;
  };
  const dispatch = () => {
    const data = dataLines.join('\n'), namedType = eventName;
    dataLines = []; eventName = ''; eventCharacters = 0;
    if (!data.trim()) return;
    if (data.trim() === '[DONE]') return fail('文字流式响应结束，但没有收到完整完成标记。', 'stream_incomplete');
    let event: JsonObject | undefined;
    try { event = object(JSON.parse(data)); } catch { return fail('文字流式事件无法解析。', 'invalid_stream_event'); }
    if (!event) return fail('文字流式事件结构无效。', 'invalid_stream_event');
    const type = text(event.type) || namedType;
    diagnostics.eventCount++;
    diagnostics.firstEventMs ??= Date.now() - startedAt;
    const envelope = object(event.response);
    if (envelope) diagnostics.response = envelope;
    if (type === 'response.output_text.delta' && typeof event.delta === 'string') receiveText(event, event.delta, true);
    if (type === 'response.output_text.done' && typeof event.text === 'string') receiveText(event, event.text, false);
    if (type === 'response.output_item.done') {
      const item = object(event.item);
      if (item?.type === 'message' && Array.isArray(item.content)) item.content.forEach((part, contentIndex) => {
        const content = object(part);
        if (content?.type === 'output_text' && typeof content.text === 'string') receiveText({ ...event, content_index: contentIndex }, content.text, false);
      });
    }
    if (type === 'error' || type === 'response.failed') {
      const detail = object(event.error) || object(envelope?.error) || event;
      return fail(text(detail.message) || '文字服务在流式生成过程中返回失败。', text(detail.code) || 'stream_response_failed');
    }
    if (type === 'response.completed' || type === 'response.incomplete') {
      if (!envelope || envelope.status !== type.slice('response.'.length)) return fail('文字流式完成事件与响应状态不一致。', 'invalid_stream_event');
      terminal = envelope;
    }
    // Gateway metadata, heartbeats and reasoning events are not final output.
  };
  const line = (value: string) => {
    if (!value) return dispatch();
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /u, '');
    if (field === 'data') { dataLines.push(content); eventCharacters += content.length; }
    if (field === 'event') eventName = content;
    if (eventCharacters > MAX_EVENT_CHARACTERS) return fail('文字流式事件超过本地接收范围。', 'stream_response_too_large');
  };
  const drain = (end = false) => {
    while (!terminal) {
      const index = buffer.search(/[\r\n]/u);
      if (index < 0 || (!end && buffer[index] === '\r' && index === buffer.length - 1)) break;
      const width = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      const value = buffer.slice(0, index); buffer = buffer.slice(index + width); line(value);
    }
    if (buffer.length + eventCharacters > MAX_EVENT_CHARACTERS) return fail('文字流式事件超过本地接收范围。', 'stream_response_too_large');
    if (end && !terminal) { if (buffer) { line(buffer); buffer = ''; } dispatch(); }
  };
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!terminal) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) { buffer += decoder.decode(); drain(true); break; }
      diagnostics.receivedBytes += value.byteLength;
      if (diagnostics.receivedBytes > MAX_STREAM_BYTES) return fail('文字流式响应超过本地接收范围。', 'stream_response_too_large');
      buffer += decoder.decode(value, { stream: true }); drain();
    }
    if (!terminal) return fail('文字流式连接已结束，但没有收到完整完成标记。', 'stream_incomplete');
    return terminal;
  } catch (error) {
    if (error instanceof ResponsesStreamError) throw error;
    return fail(error instanceof Error ? error.message : '文字流式连接中断。', signal.aborted ? 'response_body_timeout' : 'response_body_read_error');
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
