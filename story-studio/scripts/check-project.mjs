import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'README.md',
  'AGENTS.md',
  '.env.example',
  'docs/PROJECT_CHARTER.md',
  'docs/ARCHITECTURE.md',
  'docs/ACCEPTANCE.md',
  'src/domain/contracts.ts',
  'src/workflow/stages.ts',
  'src/providers/contracts.ts',
  '.ai-pm/PROJECT_STATE.md'
];

for (const relativePath of required) {
  await access(resolve(root, relativePath));
}

const projectConfig = JSON.parse(
  await readFile(resolve(root, 'config/project.example.json'), 'utf8')
);

if (projectConfig.executionMode !== 'approval') {
  throw new Error('The example project must default to approval mode.');
}

if (projectConfig.video.provider !== 'prism-h3') {
  throw new Error('The example project must use PRISM H3 as its video provider.');
}

console.log(`Project baseline check passed: ${required.length} required files and config validated.`);

