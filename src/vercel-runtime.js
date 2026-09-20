import { loadConfig } from './config.js';
import { createDatabaseForConfig } from './database.js';
import { createMetaClient } from './meta-client.js';
import { createVercelBlobMediaStore } from './media-store.js';
import { createR2MediaStore } from './r2-media.js';
import { createRequestHandler } from './request-handler.js';

const defaultFactories = {
  createDatabase: createDatabaseForConfig,
  createMediaStore: createVercelBlobMediaStore,
  createMetaClient
};

export function createLazyVercelHandler(initialize = () => createVercelHandler()) {
  let handler;
  return async (request, response) => {
    try {
      handler ??= initialize();
    } catch (error) {
      console.error('[boot] Unable to initialize application', error);
      response.writeHead(503, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      });
      response.end(JSON.stringify({ error: 'Máy chủ chưa sẵn sàng. Vui lòng thử lại sau.' }));
      return;
    }
    return handler(request, response);
  };
}

export function createVercelHandler(environment = process.env, factories = defaultFactories) {
  const config = loadConfig(environment);
  const db = factories.createDatabase(config);
  const metaClient = factories.createMetaClient(config);
  const mediaStore = factories.createMediaStore({ config, db });
  const r2MediaStore = createR2MediaStore({ config, db });
  if (r2MediaStore) {
    mediaStore.r2 = r2MediaStore;
    const blobGetMedia = mediaStore.getMedia.bind(mediaStore);
    const blobGetMetaFetchUrl = mediaStore.getMetaFetchUrl.bind(mediaStore);
    mediaStore.getMedia = async (options) => {
      const metadata = await db.getMedia(options.ownerMetaUserId, options.id);
      return metadata?.blobUrl?.startsWith('r2://') ? r2MediaStore.getMedia(options) : blobGetMedia(options);
    };
    mediaStore.getMetaFetchUrl = async (options) => {
      const metadata = await db.getMedia(options.ownerMetaUserId, options.id);
      return metadata?.blobUrl?.startsWith('r2://') ? r2MediaStore.getMetaFetchUrl(options) : blobGetMetaFetchUrl(options);
    };
    mediaStore.deleteTemporaryMedia = (media) => r2MediaStore.deleteTemporaryMedia(media);
  }
  const requestHandler = createRequestHandler({ config, db, metaClient, mediaStore });

  return async function handleVercelRequest(request, response) {
    const originalUrl = request.url;
    if (originalUrl) {
      const routedUrl = new URL(originalUrl, 'http://localhost');
      const routedPath = routedUrl.pathname === '/api/router'
        ? routedUrl.searchParams.get('__path')
        : null;

      if (routedPath && !routedPath.split('/').includes('..')) {
        routedUrl.searchParams.delete('__path');
        request.url = `/api/${routedPath.replace(/^\/+/, '')}${routedUrl.search}`;
      }
    }
    if (request.url?.match(/^\/api\/health(?:[?#]|$)/)) {
      request.url = request.url.replace(/^\/api\/health/, '/health');
    }
    try {
      await requestHandler(request, response);
    } finally {
      request.url = originalUrl;
    }
  };
}
