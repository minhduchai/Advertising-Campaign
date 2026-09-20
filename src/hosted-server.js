import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createDatabaseForConfig } from './database.js';
import { createMetaClient } from './meta-client.js';
import { createLocalMediaStore } from './media-store.js';
import { createR2MediaStore } from './r2-media.js';
import { createRequestHandler } from './request-handler.js';

const config = loadConfig();
const db = createDatabaseForConfig(config);
const mediaStore = config.mediaUploadMode === 'r2'
  ? createR2MediaStore({ config, db })
  : createLocalMediaStore({ db });
if (mediaStore && config.mediaUploadMode === 'r2') mediaStore.r2 = mediaStore;
const handler = createRequestHandler({
  config,
  db,
  metaClient: createMetaClient(config),
  mediaStore
});
const port = Number(process.env.PORT ?? 3000);
createServer(handler).listen(port, '127.0.0.1', () => {
  console.log(`Campaign Builder is listening on http://127.0.0.1:${port} (${config.mediaUploadMode})`);
});
