import test from "node:test";
import assert from "node:assert/strict";
import { isPublishStep, runPublishBatch, PUBLISH_BATCH_SIZE, MAX_DEADLINE_CALLS } from "../src/publish-batch.js";

test("isPublishStep chỉ nhận bước publish:N", () => {
  assert.equal(isPublishStep({ key: "publish:3" }), true);
  assert.equal(isPublishStep({ key: "publication:realtime:publish:3" }), false);
  assert.equal(isPublishStep({ key: "seeding:prepare:publish:3" }), false);
  assert.equal(isPublishStep({ key: "media:prepare" }), false);
});

test("gọi lại cho tới khi đủ batch, dừng sớm khi complete", async () => {
  const responses = [{ attempted: 2, complete: false }, { attempted: 1, complete: false }, { attempted: 1, complete: false }, { attempted: PUBLISH_BATCH_SIZE, complete: false }];
  const calls = [];
  const result = await runPublishBatch(async (call) => { calls.push(call); return responses[call - 1]; });
  assert.deepEqual(calls, [1, 2, 3, 4]);
  assert.equal(result.attempted, PUBLISH_BATCH_SIZE);

  calls.length = 0;
  await runPublishBatch(async (call) => { calls.push(call); return { attempted: 1, complete: call === 2 }; });
  assert.deepEqual(calls, [1, 2]);
});

test("Server cũ không trả attempted → một lần gọi như trước; không bao giờ vượt PUBLISH_BATCH_SIZE lần", async () => {
  const calls = [];
  await runPublishBatch(async (call) => { calls.push(call); return { status: "creating", complete: false }; });
  assert.deepEqual(calls, [1]);

  calls.length = 0;
  await runPublishBatch(async (call) => { calls.push(call); return { attempted: null, complete: false }; });
  assert.deepEqual(calls, [1]);

  calls.length = 0;
  await runPublishBatch(async (call) => { calls.push(call); return { attempted: 1, complete: false }; });
  assert.equal(calls.length, PUBLISH_BATCH_SIZE);
});

test("attempted 0 không kèm deadlineHit nghĩa là hết việc: dừng, không coi là đủ batch rồi xoay vòng", async () => {
  const calls = [];
  const result = await runPublishBatch(async (call) => { calls.push(call); return { attempted: 0, complete: false }; });
  assert.deepEqual(calls, [1]);
  assert.equal(result.attempted, 0);
});

test("chạm mốc cứng (deadlineHit) thì gọi lại để làm tiếp và chờ ngắn khi chưa tạo được node nào", async () => {
  const pauses = [];
  const calls = [];
  const responses = [
    { attempted: 3, complete: false, deadlineHit: true },
    { attempted: 0, complete: false, deadlineHit: true },
    { attempted: PUBLISH_BATCH_SIZE - 3, complete: true }
  ];
  const result = await runPublishBatch(
    async (call) => { calls.push(call); return responses[call - 1]; },
    async (call, ms) => { pauses.push([call, ms]); }
  );
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(pauses, [[2, 5000]]);
  assert.equal(result.complete, true);
});

test("deadlineHit liên tục không làm vòng lặp chạy vô hạn", async () => {
  let count = 0;
  await runPublishBatch(async () => { count += 1; return { attempted: 0, complete: false, deadlineHit: true }; });
  assert.ok(count <= MAX_DEADLINE_CALLS + 1, `đã gọi ${count} lần`);
});

test("đường 429 retryable thoát ngay để workflow ngủ rồi thử lại", async () => {
  const calls = [];
  const result = await runPublishBatch(async (call) => { calls.push(call); return { retryable: true }; });
  assert.deepEqual(calls, [1]);
  assert.equal(result.retryable, true);
});
