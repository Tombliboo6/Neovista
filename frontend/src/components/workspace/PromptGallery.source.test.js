import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./PromptGallery.jsx', import.meta.url), 'utf8');

test('PromptGallery displays and copies the backend effective prompt', () => {
  assert.match(source, /TemplatePromptPreview/);
  assert.match(source, /templateId=\{template\.id\}/);
  assert.doesNotMatch(source, /template\.display_text \|\| template\.real_prompt/);
});
