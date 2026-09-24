import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

// Serve map code and styles from our own deployment; only map tiles are remote.
await mkdir('public/vendor/leaflet', { recursive: true });
await Promise.all([
  ...['leaflet.js', 'leaflet.css', 'images'].map((file) => cp(
    `node_modules/leaflet/dist/${file}`, `public/vendor/leaflet/${file}`, { recursive: true }
  )),
  cp('node_modules/leaflet/LICENSE', 'public/vendor/leaflet/LICENSE')
]);

await build({
    entryPoints: ['public/telegram-upload-client.js'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    minify: true
  });
