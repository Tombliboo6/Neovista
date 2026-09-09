export type FreeCanvasReferenceMentionKind = "image" | "video" | "audio";
export type FreeCanvasReferenceMentionRange = { start: number; end: number; query: string };

const LABELS: Record<FreeCanvasReferenceMentionKind, string> = { image: "图片", video: "视频", audio: "音频" };
const H3_TAGS: Record<FreeCanvasReferenceMentionKind, string> = { image: "Picture", video: "Video", audio: "Audio" };

export function freeCanvasReferenceMentionToken(kind: FreeCanvasReferenceMentionKind, index: number) {
  return `@${LABELS[kind]}${index + 1}`;
}

export function freeCanvasReferenceMentionLabel(kind: FreeCanvasReferenceMentionKind) {
  return LABELS[kind];
}

export function findFreeCanvasReferenceMention(value: string, cursor: number): FreeCanvasReferenceMentionRange | null {
  const safeCursor = Math.max(0, Math.min(value.length, cursor));
  const beforeCursor = value.slice(0, safeCursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) return null;
  const query = beforeCursor.slice(atIndex + 1);
  if (/[\s<>@]/u.test(query) || /^(图片|视频|音频)\s*\d+/u.test(query)) return null;
  const previous = atIndex > 0 ? beforeCursor[atIndex - 1] : "";
  if (query && /[A-Za-z0-9._%+-]/u.test(previous) && /^[A-Za-z0-9._%+-]+$/u.test(query)) return null;
  return { start: atIndex, end: safeCursor, query };
}

export function compileFreeCanvasReferenceMentions(prompt: string, counts?: Partial<Record<FreeCanvasReferenceMentionKind, number>>) {
  let compiled = prompt;
  for (const kind of Object.keys(LABELS) as FreeCanvasReferenceMentionKind[]) {
    const label = LABELS[kind];
    compiled = compiled.replace(new RegExp(`@${label}\\s*(\\d+)`, "gu"), (_match, indexText: string) => {
      const index = Number(indexText);
      const available = counts?.[kind];
      if (!Number.isInteger(index) || index < 1 || (Number.isInteger(available) && index > Number(available))) {
        throw new Error(`提示词使用了 @${label}${indexText}，但当前只有${Number(available) || 0}项${label}参考。`);
      }
      return `<${H3_TAGS[kind]} ${index}>`;
    });
  }
  return compiled;
}

export function compileFreeCanvasImageReferenceMentions(prompt: string, imageCount: number) {
  const unsupported = prompt.match(/@(视频|音频)\s*\d+/u);
  if (unsupported) throw new Error(`图片节点不能使用${unsupported[0]}，请改用上方图片参考。`);
  return prompt.replace(/@图片\s*(\d+)/gu, (_match, indexText: string) => {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 1 || index > imageCount) {
      throw new Error(`提示词使用了 @图片${indexText}，但当前只有${imageCount}项图片参考。`);
    }
    return `参考图${index}`;
  });
}
