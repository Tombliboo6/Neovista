import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ChatHistory.jsx', import.meta.url), 'utf8');

test('ChatHistory renders uploaded user images together with the same user message', () => {
  assert.match(source, /msg\.imageDatas\?\.length > 0/);
  assert.match(source, /msg\.imageDatas\.map\(\(imageSrc,\s*imageIndex\)/);
  assert.match(source, /<img[\s\S]*src=\{imageSrc\}[\s\S]*alt=""/);
  assert.match(source, /<div className="max-w-\[85%\] space-y-2">/);
  assert.match(source, /className="max-w-\[85%\] rounded-xl px-3 py-2 text-xs text-white\/80"/);
});

test('ChatHistory exposes a generated original image download action', () => {
  assert.match(source, /Download/);
  assert.match(source, /const handleDownloadImage = async \(imageUrl\) =>/);
  assert.match(source, /handleDownloadImage\(msg\.imageUrl\)/);
  assert.match(source, />\s*<Download size=\{12\} \/> 下载原图\s*<\/button>/);
});

test('ChatHistory adapts its empty state to narrative video work', () => {
  assert.match(source, /ChatHistory\(\{ storyMode = false \}\)/);
  assert.match(source, /选择一个镜头继续/);
  assert.match(source, /补齐镜头、轴线与参考图/);
  assert.doesNotMatch(source, /让 Agent 继续拆解剧本/);
});
