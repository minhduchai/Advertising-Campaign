import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createDatabase } from '../src/db.js';
import { encryptToken, signSession } from '../src/crypto.js';
import { request, testConfig } from './helpers.js';

function connectedFixture(mediaStore) {
  const config = testConfig();
  const database = createDatabase(':memory:');
  const server = createServer({ config, db: database, metaClient: {}, ...(mediaStore ? { mediaStore } : {}) });
  return {
    database,
    server,
    connect(metaUserId) {
      const session = database.createSession();
      database.attachMetaUser(session.id, { id: metaUserId, name: metaUserId });
      database.upsertConnection({
        metaUserId,
        metaUserName: metaUserId,
        accessTokenCiphertext: encryptToken(`token-${metaUserId}`, config.tokenEncryptionKey)
      });
      return `meta_ads_session=${encodeURIComponent(signSession(session.id, config.sessionSecret))}`;
    }
  };
}

function jsonOptions(cookie, method, body = {}) {
  return {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

test('saving seeding templates preserves owned media and blocks saves when copying fails', async context => {
  const preserved = [];
  let fail = false;
  const fixture = connectedFixture({ preserveSeedingMedia: async input => {
    if (fail) throw new Error('copy failed');
    preserved.push(input);
  } });
  context.after(() => fixture.server.close());
  const cookie = fixture.connect('owner');
  saveMedia(fixture.database, { id: 'seed', ownerMetaUserId: 'owner' });
  const input = { name: 'Seed', items: [{ id: 'item', message: 'Hello', imageMediaId: 'seed' }] };
  const created = await request(fixture.server, '/api/seeding-templates', jsonOptions(cookie, 'POST', input));
  assert.equal(created.status, 201);
  assert.deepEqual(preserved, [{ ownerMetaUserId: 'owner', id: 'seed' }]);
  const updated = await request(fixture.server, `/api/seeding-templates/${created.body.template.id}`, jsonOptions(cookie, 'PUT', input));
  assert.equal(updated.status, 200);
  assert.equal(preserved.length, 2);
  fail = true;
  const rejected = await request(fixture.server, '/api/seeding-templates', jsonOptions(cookie, 'POST', input));
  assert.equal(rejected.status, 500);
  assert.equal(fixture.database.listSeedingTemplates('owner').length, 1);
});

function rawJsonOptions(cookie, method, body) {
  return {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(500)
  };
}

function saveMedia(database, input) {
  return database.saveMedia({
    name: 'default.png',
    mimeType: 'image/png',
    content: Buffer.from('image-content'),
    sizeBytes: 13,
    ...input
  });
}

test('owner CRUD serializes seeding image metadata from the database and retains media after deletion', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const ownerOneCookie = fixture.connect('owner-1');
  const ownerTwoCookie = fixture.connect('owner-2');
  saveMedia(fixture.database, {
    id: 'image-1',
    ownerMetaUserId: 'owner-1',
    name: 'stored-image.png',
    sizeBytes: 4_096,
    blobUrl: 'https://private.example.test/stored-image.png?token=secret'
  });
  saveMedia(fixture.database, {
    id: 'image-2',
    ownerMetaUserId: 'owner-1',
    name: 'updated-image.png',
    sizeBytes: 8_192
  });

  const created = await request(fixture.server, '/api/seeding-templates', jsonOptions(ownerOneCookie, 'POST', {
    name: '  Triệt nách nữ  ',
    items: [{
      id: 'item-1',
      message: 'Comment 1',
      imageMediaId: 'image-1',
      imageName: 'untrusted-name.jpg',
      imageSize: 1,
      imagePreviewUrl: 'https://private.example.test/untrusted'
    }]
  }));
  assert.equal(created.status, 201);
  assert.equal(created.body.template.name, 'Triệt nách nữ');
  assert.deepEqual(created.body.template.items, [{
    id: 'item-1',
    message: 'Comment 1',
    imageMediaId: 'image-1',
    imageName: 'stored-image.png',
    imageSize: 4_096,
    imageMimeType: 'image/png',
    imagePreviewUrl: '/api/media/image-1/preview'
  }]);
  assert.doesNotMatch(JSON.stringify(created.body), /ownerMetaUserId|blobUrl|blobDownloadUrl|blobPathname|content|secret|untrusted/);

  const updated = await request(
    fixture.server,
    `/api/seeding-templates/${created.body.template.id}`,
    jsonOptions(ownerOneCookie, 'PUT', {
      name: 'Mẫu đã sửa',
      items: [{ id: 'item-1', message: '', imageMediaId: 'image-2' }]
    })
  );
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.template.items[0], {
    id: 'item-1',
    message: '',
    imageMediaId: 'image-2',
    imageName: 'updated-image.png',
    imageSize: 8_192,
    imageMimeType: 'image/png',
    imagePreviewUrl: '/api/media/image-2/preview'
  });

  const duplicated = await request(
    fixture.server,
    `/api/seeding-templates/${created.body.template.id}/duplicate`,
    jsonOptions(ownerOneCookie, 'POST', { name: 'Bản sao' })
  );
  assert.equal(duplicated.status, 201);
  assert.equal(duplicated.body.template.name, 'Bản sao');
  assert.deepEqual(duplicated.body.template.items, updated.body.template.items);
  assert.doesNotMatch(JSON.stringify(duplicated.body), /ownerMetaUserId|blobUrl|content/);

  const foreignDelete = await request(fixture.server, `/api/seeding-templates/${created.body.template.id}`, {
    method: 'DELETE',
    headers: { cookie: ownerTwoCookie }
  });
  assert.equal(foreignDelete.status, 404);
  assert.equal((await request(fixture.server, '/api/seeding-templates', { headers: { cookie: ownerTwoCookie } })).body.templates.length, 0);

  const deleted = await request(fixture.server, `/api/seeding-templates/${created.body.template.id}`, {
    method: 'DELETE',
    headers: { cookie: ownerOneCookie }
  });
  assert.deepEqual(deleted.body, { deleted: true });
  assert.ok(fixture.database.getMedia('owner-1', 'image-2'));
});

test('seeding template writes accept video and reject absent, foreign, unsupported, and oversized media', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const ownerOneCookie = fixture.connect('owner-1');
  saveMedia(fixture.database, { id: 'foreign-image', ownerMetaUserId: 'owner-2' });
  saveMedia(fixture.database, { id: 'unsupported-file', ownerMetaUserId: 'owner-1', mimeType: 'image/webp' });
  saveMedia(fixture.database, { id: 'large-image', ownerMetaUserId: 'owner-1', sizeBytes: 200 * 1024 * 1024 + 1 });

  for (const imageMediaId of ['missing-image', 'foreign-image', 'unsupported-file', 'large-image']) {
    const response = await request(fixture.server, '/api/seeding-templates', jsonOptions(ownerOneCookie, 'POST', {
      name: 'Mẫu kiểm tra',
      items: [{
        id: `item-${imageMediaId}`,
        message: 'Comment 1',
        imageMediaId,
        imageName: 'client-controls-nothing.jpg',
        imageSize: 1
      }]
    }));
    assert.equal(response.status, 422, imageMediaId);
    assert.ok(response.body.errors.some(({ path }) => path === 'items.0.imageMediaId'), imageMediaId);
  }

  saveMedia(fixture.database, { id: 'video-file', ownerMetaUserId: 'owner-1', mimeType: 'video/mp4', sizeBytes: 200 * 1024 * 1024 });
  const accepted = await request(fixture.server, '/api/seeding-templates', jsonOptions(ownerOneCookie, 'POST', {
    name: 'Mẫu video',
    items: [{ id: 'video-item', message: 'Video', imageMediaId: 'video-file' }]
  }));
  assert.equal(accepted.status, 201);
});

test('seeding template creation returns validation errors for valid falsy JSON payloads', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const cookie = fixture.connect('owner-1');

  for (const payload of [null, false, 0, '']) {
    const response = await request(
      fixture.server,
      '/api/seeding-templates',
      rawJsonOptions(cookie, 'POST', payload)
    );
    assert.equal(response.status, 422, JSON.stringify(payload));
    assert.ok(response.body.errors.some(({ path }) => path === 'name'));
    assert.ok(response.body.errors.some(({ path }) => path === 'items'));
  }
});

test('seeding template updates return validation errors for valid falsy JSON payloads', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const cookie = fixture.connect('owner-1');
  const template = fixture.database.createSeedingTemplate({
    ownerMetaUserId: 'owner-1',
    name: 'Mẫu nguồn',
    items: [{ id: 'item-1', message: 'Comment 1', imageMediaId: null }]
  });

  for (const payload of [null, false, 0, '']) {
    const response = await request(
      fixture.server,
      `/api/seeding-templates/${template.id}`,
      rawJsonOptions(cookie, 'PUT', payload)
    );
    assert.equal(response.status, 422, JSON.stringify(payload));
    assert.ok(response.body.errors.some(({ path }) => path === 'name'));
    assert.ok(response.body.errors.some(({ path }) => path === 'items'));
  }
});

test('seeding template duplication validates a name for valid falsy JSON payloads', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const cookie = fixture.connect('owner-1');
  const template = fixture.database.createSeedingTemplate({
    ownerMetaUserId: 'owner-1',
    name: 'Mẫu nguồn',
    items: [{ id: 'item-1', message: 'Comment 1', imageMediaId: null }]
  });

  for (const payload of [null, false, 0, '']) {
    const response = await request(
      fixture.server,
      `/api/seeding-templates/${template.id}/duplicate`,
      rawJsonOptions(cookie, 'POST', payload)
    );
    assert.equal(response.status, 422, JSON.stringify(payload));
    assert.ok(response.body.errors.some(({ path }) => path === 'name'));
  }
});
