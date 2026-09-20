export const RUN_STREAM_CONTENT_TYPE = 'application/x-ndjson';

export function acceptsRunStream(request) {
  return String(request.headers.accept ?? '')
    .split(',')
    .some((value) => value.trim().split(';')[0] === RUN_STREAM_CONTENT_TYPE);
}

export function startRunStream(response, status = 201) {
  response.writeHead(status, {
    'content-type': `${RUN_STREAM_CONTENT_TYPE}; charset=utf-8`,
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no'
  });
  response.flushHeaders?.();
}

export function writeRunEvent(response, event) {
  if (response.writableEnded || response.destroyed) return false;
  return response.write(`${JSON.stringify(event)}\n`);
}
