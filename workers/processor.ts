import type { Job } from 'bullmq'
import { z } from 'zod'

const example = z.object({ message: z.string().min(1).max(200) })

export async function processJob(job: Pick<Job, 'name' | 'data'>) {
  switch (job.name) {
    case 'heartbeat': return { ok: true }
    case 'example': return { accepted: example.parse(job.data).message }
    default: throw new Error('Unknown job name: ' + job.name)
  }
}
// Jobs are at-least-once: real external side effects need idempotency keys or a DB transaction.
