import { describe, it, expect } from 'vitest'
import { processJob } from '../workers/processor'

describe('worker processor', () => {
  it('processes a heartbeat', async () => {
    expect(await processJob({
      name: 'heartbeat',
      data: {},
    })).toEqual({ ok: true })
  })
  it('validates job data', async () => {
    await expect(processJob({
      name: 'example',
      data: {},
    })).rejects.toThrow()
  })
  it('rejects unknown job types', async () => {
    await expect(processJob({
      name: 'unexpected',
      data: {},
    })).rejects.toThrow('Unknown job')
  })
})
