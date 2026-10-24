import { Worker } from 'bullmq'
import { connection, queuePrefix, queueName } from './connection'
import { processJob } from './processor'

const redis = connection(true)
const worker = new Worker(queueName, processJob, {
  connection: redis,
  prefix: queuePrefix(),
  concurrency: 5,
})
worker.on('error', () => console.error('Worker connection or processing error'))
worker.on('failed', job => console.error('Job failed', {
  id: job?.id,
  name: job?.name,
}))
worker.on('completed', job => console.info('Job completed', {
  id: job.id,
  name: job.name,
}))
let closing = false
async function close() {
  if (closing) {
    return
  }
  closing = true
  try {
    await worker.close()
  } finally {
    redis.disconnect()
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    close().catch(() => {
      process.exitCode = 1
    })
  })
}
await worker.waitUntilReady()
console.info('Worker ready')
