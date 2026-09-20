import test from "node:test";
import assert from "node:assert/strict";
import { isPublishStep, runPublishBatch, PUBLISH_BATCH_SIZE } from "../src/publish-batch.js";

test("isPublishStep chỉ nhận bước publish:N", () => {
  assert.equal(isPublishStep({ key: "publish:3" }), true);
  assert.equal(isPublishStep({ key: "publication:realtime:publish:3" }), false);
  assert.equal(isPublishStep({ key: "seeding:prepare:publish:3" }), false);
});

test("gọi lại cho tới khi đủ batch, dừng sớm khi complete", async () => {
  const responses = [{ attempted: 2, complete: false }, { attempted: 1, complete: false }, { attempted: 1, complete: false }, { attempted: 4, complete: false }];
  const calls = [];
  const result = await runPublishBatch(async (call) => { calls.push(call); return responses[call - 1]; });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.attempted, 1);

  calls.length = 0;
  await runPublishBatch(async (call) => { calls.push(call); return { attempted: 1, complete: call === 2 }; });
  assert.deepEqual(calls, [1, 2]);
});

test("Vercel cũ không trả attempted → một lần gọi như trước; không bao giờ vượt PUBLISH_BATCH_SIZE lần", async () => {
  const calls = [];
  await runPublishBatch(async (call) => { calls.push(call); return { status: "creating", complete: false }; });
  assert.deepEqual(calls, [1]);

  calls.length = 0;
  await runPublishBatch(async (call) => { calls.push(call); return { attempted: 0, complete: false }; });
  assert.deepEqual(calls, [1]);

  calls.length = 0;
  await runPublishBatch(async (call) => { calls.push(call); return { attempted: 1, complete: false }; });
  assert.equal(calls.length, PUBLISH_BATCH_SIZE);
});
