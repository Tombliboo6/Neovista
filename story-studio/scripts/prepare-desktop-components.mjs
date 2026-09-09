import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const lock = JSON.parse(readFileSync(resolve(import.meta.dirname, 'desktop-components.lock.json'), 'utf8'));
const outputRoot = resolve(projectRoot, 'desktop-resources/tools');
const downloadsRoot = resolve(projectRoot, '.tmp/third-party-downloads');
const ffmpegRoot = resolve(process.env.PRISM_FFMPEG_BUNDLE_ROOT || resolve(downloadsRoot, 'ffmpeg-lgpl-verified/ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-shared-8.1'));
const realEsrganRoot = resolve(process.env.PRISM_REALESRGAN_BUNDLE_ROOT || resolve(downloadsRoot, 'realesrgan-official-verified'));
const licenseRoot = resolve(process.env.PRISM_COMPONENT_LICENSE_ROOT || resolve(downloadsRoot, 'licenses'));

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').toUpperCase();
}

function validateFiles(component, sourceRoot) {
  for (const entry of component.files) {
    const source = resolve(sourceRoot, entry.path);
    if (!existsSync(source)) throw new Error(`组件文件缺失：${source}`);
    const actual = hashFile(source);
    if (actual !== entry.sha256) throw new Error(`组件文件校验失败：${source}\n期望 ${entry.sha256}\n实际 ${actual}`);
  }
}

function copyFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

validateFiles(lock.ffmpeg, ffmpegRoot);
validateFiles(lock.realEsrgan, realEsrganRoot);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

for (const entry of lock.ffmpeg.files) {
  const destination = entry.path.startsWith('bin/')
    ? resolve(outputRoot, basename(entry.path))
    : resolve(outputRoot, 'licenses/FFmpeg-LGPLv3.txt');
  copyFile(resolve(ffmpegRoot, entry.path), destination);
}

for (const entry of lock.realEsrgan.files) {
  copyFile(resolve(realEsrganRoot, entry.path), resolve(outputRoot, 'real-esrgan', entry.path));
}

for (const filename of ['Real-ESRGAN-BSD-3-Clause.txt', 'Real-ESRGAN-ncnn-vulkan-MIT.txt', 'ncnn-BSD-3-Clause.txt']) {
  const source = resolve(licenseRoot, filename);
  if (!existsSync(source)) throw new Error(`许可证文件缺失：${source}`);
  copyFile(source, resolve(outputRoot, 'licenses', filename));
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  components: {
    ffmpeg: { version: lock.ffmpeg.version, variant: lock.ffmpeg.variant, release: lock.ffmpeg.release, archiveUrl: lock.ffmpeg.archiveUrl, archiveSha256: lock.ffmpeg.archiveSha256 },
    realEsrgan: { version: lock.realEsrgan.version, archiveUrl: lock.realEsrgan.archiveUrl, archiveSha256: lock.realEsrgan.archiveSha256 },
  },
};
writeFileSync(resolve(outputRoot, 'component-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Desktop components prepared: ${outputRoot}`);
