import { Queue } from 'bullmq'
import { connection, queuePrefix, queueName } from './connection'

const redis = connection()
const queue = new Queue(queueName, {
  connection: redis,
  prefix: queuePrefix(),
})
try {
  const job = await queue.add('example', { message: 'Hello from the starter' }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 1000,
  })
  console.info('Queued job', job.id)
} finally {
  await queue.close()
  redis.disconnect()
}
