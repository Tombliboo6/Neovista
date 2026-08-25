export const MAX_STORY_FILE_BYTES = 512 * 1024;
export const STORY_FILE_ACCEPT = '.md,.markdown,.txt,text/markdown,text/plain';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

const getExtension = (name) => {
  const normalized = String(name || '').trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
};

export async function readStoryScriptFile(file, { maxBytes = MAX_STORY_FILE_BYTES } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('请选择有效的剧本文件');
  }
  if (!SUPPORTED_EXTENSIONS.has(getExtension(file.name))) {
    throw new Error('仅支持 .md、.markdown 或 .txt 剧本文件');
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('剧本文件为空');
  }
  if (size > maxBytes) {
    throw new Error(`剧本文件超过 ${Math.round(maxBytes / 1024)}KB，请拆分后再导入`);
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error('剧本不是有效的 UTF-8 文本，请转换编码后重试');
  }
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) {
    throw new Error('剧本文件没有可用文字');
  }
  return {
    name: String(file.name || '未命名剧本'),
    text: normalized,
    characterCount: normalized.length,
    byteSize: size,
  };
}
