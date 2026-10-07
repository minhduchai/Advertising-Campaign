import test from 'node:test';
import assert from 'node:assert/strict';
import { waitWithRunHeartbeat, startRunStream } from '../src/run-stream.js';
import { EventEmitter } from 'node:events';

test('the stream sends heartbeats during an in-flight API request and stops on finish', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const writes = [];
  const response = Object.assign(new EventEmitter(), { writeHead() {}, flushHeaders() {}, write: value => writes.push(value) });
  startRunStream(response);
  t.mock.timers.tick(75000);
  assert.equal(writes.length, 3);
  response.emit('finish');
  t.mock.timers.tick(50000);
  assert.equal(writes.length, 3);
});

test('quota waits send blank heartbeats, stop writing after disconnect and clear the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const writes = [];
  const response = { write: (value) => writes.push(value), destroyed: false };
  const waiting = waitWithRunHeartbeat(response, 75000);
  t.mock.timers.tick(25000);
  assert.deepEqual(writes, ['\n']);
  response.destroyed = true;
  t.mock.timers.tick(50000);
  await waiting;
  response.destroyed = false;
  t.mock.timers.tick(50000);
  assert.deepEqual(writes, ['\n']);
});
