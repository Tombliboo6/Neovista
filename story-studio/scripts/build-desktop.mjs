import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'desktop-dist');
const webDist = resolve(root, 'web/dist');
const stylePresets = resolve(root, 'runtime-data/style-presets');
const promptWritingStandard = resolve(root, 'docs/AI_GENERATION_PROMPT_STANDARD.md');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

if (!existsSync(webDist)) throw new Error('网页生产构建不存在，请先运行 npm run web:build。');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(webDist, resolve(output, 'web'), { recursive: true });
if (existsSync(stylePresets)) cpSync(stylePresets, resolve(output, 'runtime-data/style-presets'), { recursive: true });
if (!existsSync(promptWritingStandard)) throw new Error('统一图片与视频提示词规范不存在。');
mkdirSync(resolve(output, 'docs'), { recursive: true });
cpSync(promptWritingStandard, resolve(output, 'docs/AI_GENERATION_PROMPT_STANDARD.md'));

await build({
  entryPoints: [resolve(root, 'web/local-api.mjs')],
  outfile: resolve(output, 'local-api.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Some bundled provider dependencies retain dynamic CommonJS requires for
  // Node built-ins. Give esbuild's ESM require shim a real Node resolver.
  banner: {
    js: "import { createRequire as __prismCreateRequire } from 'node:module'; const require = __prismCreateRequire(import.meta.url);"
  },
  sourcemap: false,
  legalComments: 'none',
});

writeFileSync(resolve(output, 'build-info.json'), `${JSON.stringify({
  productName: 'PRISM Story Studio',
  version: packageJson.version,
  builtAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8');

console.log(`Desktop runtime prepared: ${output}`);
