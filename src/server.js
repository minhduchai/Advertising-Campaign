import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDatabaseForConfig } from './database.js';
import { createMetaClient } from './meta-client.js';
import { createRequestHandler } from './request-handler.js';
import { createLocalMediaStore } from './media-store.js';

export function createServer({ config, metaClient, db, mediaStore, addressGeocoder }) {
  if (!db) {
    throw new TypeError('createServer requires a database');
  }
  if (config.mediaUploadMode !== 'local') {
    throw new TypeError('Local server only supports local media uploads');
  }
  return createHttpServer(createRequestHandler({
    config,
    metaClient,
    db,
    addressGeocoder,
    mediaStore: mediaStore ?? createLocalMediaStore({ db })
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  if (config.mediaUploadMode !== 'local') {
    throw new TypeError('Local server bootstrap only supports local media uploads');
  }
  const db = createDatabaseForConfig(config);
  const server = createServer({
    config,
    metaClient: createMetaClient(config),
    db,
    mediaStore: createLocalMediaStore({ db })
  });
  server.listen(config.port, () => {
    console.log(`Meta Ads Campaign Builder is running at http://localhost:${config.port}`);
  });
}
