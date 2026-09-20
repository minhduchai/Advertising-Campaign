import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';

const contentTypes = {
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

export const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;

export function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export async function sendPublicFile(response, publicDirectory, fileName) {
  const path = join(publicDirectory, fileName);
  const content = await readFile(path);
  response.writeHead(200, {
    'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
    'cache-control': response.getHeader('Cache-Control') ?? 'no-cache'
  });
  response.end(content);
}

export async function readJson(request, maximumBytes = MAX_JSON_BODY_BYTES) {
  const content = await readBuffer(request, maximumBytes);
  try {
    return JSON.parse(content.toString('utf8'));
  } catch {
    const error = new SyntaxError('Payload JSON không hợp lệ');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
}

export async function readBuffer(request, maximumBytes = Number.POSITIVE_INFINITY) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maximumBytes) {
      const error = new RangeError('Request body is too large');
      error.statusCode = 413;
      error.expose = true;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readFormData(request) {
  const webRequest = new Request('http://localhost/upload', {
    method: request.method,
    headers: request.headers,
    body: Readable.toWeb(request),
    duplex: 'half'
  });
  return webRequest.formData();
}
