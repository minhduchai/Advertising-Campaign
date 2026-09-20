// Khớp WORKFLOW_PUBLISH_BATCH_SIZE phía Vercel.
export const PUBLISH_BATCH_SIZE = 4;

export function isPublishStep(plannedStep) {
  return /^publish:\d+$/.test(String(plannedStep?.key ?? ""));
}

// Vercel trả về trước khi Cloudflare cắt fetch (~100s) nên một lần gọi có thể chưa đủ
// PUBLISH_BATCH_SIZE node. Gọi lại cho tới khi đủ batch hoặc đã tạo xong toàn bộ.
// Vercel cũ không trả `attempted` → coi như đủ batch (giữ hành vi cũ).
export async function runPublishBatch(doStep) {
  let attempted = 0;
  let result = null;
  for (let call = 1; call <= PUBLISH_BATCH_SIZE; call += 1) {
    result = await doStep(call);
    if (result?.retryable) break;
    attempted += Number(result?.attempted) || PUBLISH_BATCH_SIZE;
    if (result?.complete === true || attempted >= PUBLISH_BATCH_SIZE) break;
  }
  return result;
}
