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

// Blank NDJSON lines keep idle proxies alive without changing the client's event protocol.
export async function waitWithRunHeartbeat(response, milliseconds) {
  const heartbeat = setInterval(() => {
    if (!response.writableEnded && !response.destroyed) response.write('\n');
  }, 25000);
  heartbeat.unref?.();
  try {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  } finally {
    clearInterval(heartbeat);
  }
}
