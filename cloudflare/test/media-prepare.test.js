import test from "node:test";
import assert from "node:assert/strict";
import { isMediaPrepareStep, nextMediaPrepareAction, MAX_MEDIA_PREPARE_ATTEMPTS } from "../src/media-prepare.js";

test("chỉ nhận bước media:prepare", () => {
  assert.equal(isMediaPrepareStep({ key: "media:prepare" }), true);
  assert.equal(isMediaPrepareStep({ key: "publish:1" }), false);
  assert.equal(isMediaPrepareStep(undefined), false);
});

test("xong khi máy chủ không còn pending", () => {
  assert.deepEqual(nextMediaPrepareAction({ pending: false, ready: 3, total: 3 }), { action: "done" });
  assert.deepEqual(nextMediaPrepareAction(undefined), { action: "done" });
});

test("còn video chưa sẵn sàng thì chờ theo retryAfterMs, kẹp trong 5s..60s", () => {
  assert.deepEqual(nextMediaPrepareAction({ pending: true, retryAfterMs: 15000 }, 0), { action: "wait", attempt: 1, waitMs: 15000 });
  assert.equal(nextMediaPrepareAction({ pending: true, retryAfterMs: 100 }, 0).waitMs, 5000);
  assert.equal(nextMediaPrepareAction({ pending: true, retryAfterMs: 999999 }, 0).waitMs, 60000);
  assert.equal(nextMediaPrepareAction({ pending: true }, 4).waitMs, 15000);
  assert.equal(nextMediaPrepareAction({ pending: true }, 4).attempt, 5);
});

test("bỏ cuộc sau số lần tối đa với thông báo rõ số video đã sẵn sàng", () => {
  const action = nextMediaPrepareAction({ pending: true, ready: 2, total: 5 }, MAX_MEDIA_PREPARE_ATTEMPTS);
  assert.equal(action.action, "give_up");
  assert.match(action.message, /2\/5 video sẵn sàng/);
});

test("số lần đã chờ không hợp lệ được coi là 0", () => {
  assert.equal(nextMediaPrepareAction({ pending: true }, "abc").attempt, 1);
  assert.equal(nextMediaPrepareAction({ pending: true }, -3).attempt, 1);
});
