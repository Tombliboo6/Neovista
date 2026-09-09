import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const installerName = `PRISM-Story-Studio-Setup-${version}.exe`;
const installer = resolve(projectRoot, 'release', installerName);
const installerChecksum = resolve(projectRoot, 'release', `PRISM-Story-Studio-Setup-${version}.sha256`);
const deliveryRoot = resolve(projectRoot, 'release', `PRISM-Story-Studio-${version}-网盘发布包`);
const deliveryArchive = `${deliveryRoot}.zip`;
const deliveryArchiveChecksum = `${deliveryArchive}.sha256`;

if (!existsSync(installer)) throw new Error(`安装包不存在：${installer}`);

function sha256(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', rejectHash);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex').toUpperCase()));
  });
}

rmSync(deliveryRoot, { recursive: true, force: true });
mkdirSync(deliveryRoot, { recursive: true });
copyFileSync(installer, resolve(deliveryRoot, installerName));
copyFileSync(resolve(projectRoot, 'docs/CLIENT_NETDISK_README.md'), resolve(deliveryRoot, 'README-安装说明.md'));
copyFileSync(resolve(projectRoot, 'docs/OPTIONAL_COMPONENTS.md'), resolve(deliveryRoot, '组件说明.md'));
copyFileSync(resolve(projectRoot, 'docs/CLIENT_THIRD_PARTY_NOTICES.md'), resolve(deliveryRoot, 'CLIENT_THIRD_PARTY_NOTICES.md'));
copyFileSync(resolve(projectRoot, 'desktop-resources/tools/component-manifest.json'), resolve(deliveryRoot, 'component-manifest.json'));

const digest = await sha256(installer);
writeFileSync(resolve(deliveryRoot, 'SHA256SUMS.txt'), `${digest}  ${installerName}\n`, 'utf8');
writeFileSync(installerChecksum, `${digest}  ${installerName}\n`, 'utf8');
writeFileSync(resolve(deliveryRoot, 'RELEASE.json'), `${JSON.stringify({
  productName: packageJson.build.productName,
  version,
  generatedAt: new Date().toISOString(),
  installer: { filename: installerName, bytes: statSync(installer).size, sha256: digest, signed: false },
}, null, 2)}\n`, 'utf8');

const sevenZipCandidates = [
  resolve(projectRoot, 'installer', 'ace', 'bin', '7za.exe'),
  'C:/Users/pr/AppData/Local/electron-builder/Cache/7zip@1.0.0/7zip-win-x64-a34pt/bin/7za.exe',
];
const sevenZip = sevenZipCandidates.find(existsSync);
if (!sevenZip) throw new Error('7za.exe 不存在，无法生成网盘 ZIP。');
rmSync(deliveryArchive, { force: true });
const compressed = spawnSync(sevenZip, ['a', '-tzip', '-mx=9', deliveryArchive, '*'], { cwd: deliveryRoot, encoding: 'utf8' });
if (compressed.status !== 0) throw new Error(`网盘 ZIP 生成失败：${compressed.stderr || compressed.stdout}`);
const archiveDigest = await sha256(deliveryArchive);
writeFileSync(deliveryArchiveChecksum, `${archiveDigest}  ${deliveryArchive.split(/[\\/]/u).at(-1)}\n`, 'utf8');

console.log(`Desktop delivery assembled: ${deliveryRoot}`);
console.log(`Desktop delivery archive: ${deliveryArchive}`);
