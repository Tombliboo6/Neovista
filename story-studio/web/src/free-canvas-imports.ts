export type FreeCanvasImportKind = "text" | "image" | "video" | "audio";

const extensionKinds: Record<string, FreeCanvasImportKind> = {
  txt: "text", md: "text", markdown: "text", json: "text", csv: "text", srt: "text", vtt: "text", ass: "text",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", bmp: "image", avif: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video", mkv: "video", avi: "video",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", flac: "audio",
};

export function classifyFreeCanvasImport(name: string, mimeType = ""): FreeCanvasImportKind | null {
  const normalizedType = mimeType.trim().toLowerCase().split(";", 1)[0];
  if (normalizedType.startsWith("text/") || ["application/json", "application/markdown"].includes(normalizedType)) return "text";
  if (normalizedType.startsWith("image/")) return "image";
  if (normalizedType.startsWith("video/")) return "video";
  if (normalizedType.startsWith("audio/")) return "audio";
  const cleanName = name.trim().split(/[?#]/u, 1)[0];
  const extension = cleanName.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase() || "";
  return extensionKinds[extension] || null;
}

export function pastedMediaUrl(value: string): { kind: Exclude<FreeCanvasImportKind, "text">; url: string; title: string } | null {
  const url = value.trim();
  if (!/^(?:https?:\/\/|\/api\/)/iu.test(url)) return null;
  const kind = classifyFreeCanvasImport(url);
  if (!kind || kind === "text") return null;
  let title = "粘贴的媒体";
  try {
    const pathname = url.startsWith("/api/") ? new URL(url, "http://127.0.0.1").pathname : new URL(url).pathname;
    title = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || title);
  } catch {
    // Keep the stable fallback title when the URL cannot be decoded.
  }
  return { kind, url, title };
}
