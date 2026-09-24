// Khớp WORKFLOW_PUBLISH_BATCH_SIZE phía application server (src/workflow-plan.js).
export const PUBLISH_BATCH_SIZE = 8;
// Khi server báo chạm mốc cứng (deadlineHit) nhưng chưa đủ batch, cho gọi thêm tối đa số lần này để làm tiếp.
export const MAX_DEADLINE_CALLS = 3;
const DEADLINE_PAUSE_MS = 5_000;

export function isPublishStep(plannedStep) {
  return /^publish:\d+$/.test(String(plannedStep?.key));
}

// Application server trả về trước khi Cloudflare cắt fetch (~100s) nên một lần gọi có thể chưa đủ
// PUBLISH_BATCH_SIZE node. Gọi lại cho tới khi đủ batch hoặc đã tạo xong toàn bộ.
// - Server cũ không trả `attempted` → coi như đủ batch (giữ hành vi cũ).
// - `attempted: 0` mà không có `deadlineHit` → không còn việc để làm trong lượt này, dừng (không xoay vòng).
// - `deadlineHit: true` → bước chạm mốc cứng; server đã đưa node dở về retry_pending nên gọi lại để làm tiếp,
//   chờ ngắn (pause) nếu lần đó chưa tạo được node nào.
export async function runPublishBatch(doStep, pause) {
  let attempted = 0;
  let deadlineCalls = 0;
  let result = null;
  for (let call = 1; call <= PUBLISH_BATCH_SIZE + MAX_DEADLINE_CALLS; call += 1) {
    result = await doStep(call);
    if (result?.retryable) break;
    const reported = result?.attempted;
    const nodes = Number.isFinite(Number(reported)) && reported !== undefined && reported !== null
      ? Number(reported)
      : PUBLISH_BATCH_SIZE;
    attempted += nodes;
    if (result?.complete === true || attempted >= PUBLISH_BATCH_SIZE) break;
    if (result?.deadlineHit === true) {
      deadlineCalls += 1;
      if (deadlineCalls > MAX_DEADLINE_CALLS) break;
      if (nodes === 0) await pause?.(call, DEADLINE_PAUSE_MS);
    } else if (nodes === 0) {
      break;
    }
  }
  return result;
}
