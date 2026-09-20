// Recover publication metadata only; never create ads or post comments.
export async function recoverPublications({ jobs, lookup, save, schedule, now = Date.now }) {
  const result = { checked: 0, resolved: 0, pending: 0, errors: 0 };
  for (const job of jobs) {
    result.checked += 1;
    let code = null;
    try {
      const publication = await lookup(job);
      if (publication?.postId && publication?.permalinkUrl) {
        await save(job, publication);
        await schedule(job, { attempts: 0, nextAt: now(), code: null });
        result.resolved += 1;
        continue;
      }
    } catch (error) {
      result.errors += 1;
      code = String(error.meta?.code ?? error.name ?? 'Error');
    }
    const attempts = Number(job.attempts ?? 0) + 1;
    await schedule(job, {
      attempts,
      nextAt: now() + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6)),
      code
    });
    result.pending += 1;
  }
  return result;
}
