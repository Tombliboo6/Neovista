import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('frontend index does not depend on Google Fonts in production', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8');
  assert.equal(html.includes('fonts.googleapis.com'), false);
  assert.equal(html.includes('fonts.gstatic.com'), false);
});

test('deploy nginx config enables gzip for static text assets', () => {
  const conf = fs.readFileSync(path.join(repoRoot, 'deploy', 'nginx', 'neovista.conf'), 'utf8');
  assert.match(conf, /\bgzip on;/);
  assert.match(conf, /\bgzip_vary on;/);
  assert.match(conf, /\bgzip_types\b[\s\S]*application\/javascript/);
  assert.match(conf, /\bgzip_types\b[\s\S]*text\/css/);
});

test('homepage project grid does not depend on blocked external image hosts', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'components', 'home', 'ProjectGrid.jsx'),
    'utf8'
  );

  assert.equal(source.includes('images.unsplash.com'), false);
});
