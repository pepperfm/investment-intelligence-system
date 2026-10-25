// Manual evidence synchronization may outlast Bun's short default idle timeout.
process.env.NITRO_BUN_IDLE_TIMEOUT ??= '255'
process.env.NITRO_HOST ??= process.env.HOST || '127.0.0.1'
await import(new URL('../.output/server/index.mjs', import.meta.url).href)
