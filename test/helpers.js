import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';

export const testConfig = () => ({
  appId: 'test-app-id',
  appSecret: 'test-app-secret',
  loginConfigId: 'test-login-config-id',
  redirectUri: 'http://localhost:3000/api/auth/meta/callback',
  apiVersion: 'v25.0',
  tokenEncryptionKey: Buffer.alloc(32, 7),
  sessionSecret: 'test-session-secret',
  port: 0,
  databasePath: ':memory:',
  isProduction: false,
  databaseUrl: '',
  mediaUploadMode: 'local'
});

export async function request(server, path, options = {}) {
  if (!server.listening) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'manual',
    ...options
  });
  const contentType = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    body: contentType.includes('application/json') ? await response.json() : await response.text(),
    sessionCookie: response.headers.get('set-cookie'),
    location: response.headers.get('location')
  };
}

export async function invoke(handler, path, options = {}) {
  const server = createHttpServer(handler);
  try {
    return await request(server, path, options);
  } finally {
    server.close();
  }
}
