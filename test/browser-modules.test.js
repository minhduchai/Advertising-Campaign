import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';

test('normal and launch-control entry points share one URL per browser module', async () => {
  const buildResult = await build({
    entryPoints: ['public/app.js'], bundle: true, write: false, metafile: true,
    external: ['/blob-upload-client.js'],
    platform: 'browser', format: 'esm', logLevel: 'silent'
  });
  const urls = Object.keys(buildResult.metafile.inputs);
  const projectModules = urls.filter((url) => url.startsWith('public/'));
  assert.ok(projectModules.includes('public/launch-preview.js'));
  assert.equal(projectModules.length, new Set(projectModules.map((url) => url.split('?')[0])).size);
  assert.ok(projectModules.every((url) => !url.includes('?')));
  const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(index, /src="\/app\.js"/);
  for (const file of await readdir(new URL('../public/', import.meta.url))) {
    if (!file.endsWith('.js') || file === 'blob-upload-client.js') continue;
    const code = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /(?:from\s*|import\s*\()\s*['"][^'"]+\.js\?/);
  }
});

test('Vercel assets require cache revalidation', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(config.headers.some((rule) => rule.headers.some((header) => header.key === 'Cache-Control' && header.value === 'no-cache')));
});
