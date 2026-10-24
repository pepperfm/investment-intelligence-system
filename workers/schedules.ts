import { Queue } from 'bullmq'
import { connection, queuePrefix, queueName } from './connection'

const redis = connection()
const queue = new Queue(queueName, {
  connection: redis,
  prefix: queuePrefix(),
})
try {
  await queue.upsertJobScheduler('hourly-heartbeat', {
    pattern: '0 * * * *',
    tz: 'UTC',
  }, {
    name: 'heartbeat',
    data: {},
    opts: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 1000,
    },
  })
  console.info('Schedules registered')
} finally {
  await queue.close()
  redis.disconnect()
}
