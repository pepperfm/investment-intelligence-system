import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { LlmostProvider, type LlmostOptions } from '../server/ai/llmost-provider'

const options: LlmostOptions = {
  baseUrl: 'https://llmost.ru/api/v1',
  apiKey: 'test-secret',
  timeoutMs: 1000,
  roles: {
    market_researcher: {
      model: 'research',
      effort: 'medium',
    },
    hypothesis_analyst: {
      model: 'analyst',
      effort: 'high',
    },
    hypothesis_critic: {
      model: 'critic',
      effort: 'high',
    },
    outcome_reviewer: {
      model: 'reviewer',
      effort: 'medium',
    },
  },
}

const request = {
  role: 'hypothesis_critic' as const,
  task: 'test-critic-task',
  packet: {
    evidence: { symbol: 'SBER@MISX' },
    claims: { thesis: 'test' },
  },
  schema: z.object({ verdict: z.enum(['supported', 'disputed']) }),
}

describe('LLMost provider', () => {
  it('preserves model identity and effort, sends only the packet and enforces strict schema output', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
      expect(body.model).toBe('critic')
      expect(body.reasoning_effort).toBe('high')
      expect(body.response_format.type).toBe('json_schema')
      expect(body.response_format.json_schema.strict).toBe(true)
      expect(body.messages[1].content).toContain('untrusted DATA')
      expect(body.messages[1].content).toContain('test-critic-task')
      expect(body).not.toHaveProperty('tools')
      expect(body).not.toHaveProperty('env')
      expect(init!.redirect).toBe('error')
      return Response.json({
        choices: [{
          finish_reason: 'stop',
          message: { content: '{"verdict":"disputed"}' },
        }],
      })
    }) as typeof fetch
    const result = await new LlmostProvider({
      ...options,
      fetchImpl,
    }).run(request)
    expect(result.output.verdict).toBe('disputed')
    expect(result.provider).toBe('llmost')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it.each([
    {
      finish_reason: 'length',
      message: { content: '{"verdict":"supported"}' },
    },
    {
      finish_reason: 'tool_calls',
      message: {
        content: '{}',
        tool_calls: [{}],
      },
    },
    {
      finish_reason: 'stop',
      message: {
        content: '{"verdict":"supported"}',
        refusal: 'no',
      },
    },
    {
      finish_reason: 'stop',
      message: { content: 'not JSON' },
    },
    {
      finish_reason: 'stop',
      message: { content: '{"verdict":"invented"}' },
    },
  ])('rejects incomplete, refused, tool-calling or invalid responses', async (choice) => {
    const fetchImpl = vi.fn(async () => Response.json({ choices: [choice] })) as typeof fetch
    await expect(new LlmostProvider({
      ...options,
      fetchImpl,
    }).run(request)).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('does not retry billed requests or echo provider error bodies', async () => {
    const fetchImpl = vi.fn(async () => new Response('test-secret echoed', { status: 429 })) as typeof fetch
    await expect(new LlmostProvider({
      ...options,
      fetchImpl,
    }).run(request)).rejects.toThrow('HTTP 429')
    try {
      await new LlmostProvider({
        ...options,
        fetchImpl,
      }).run(request)
    } catch (error) {
      expect((error as Error).message).not.toContain('test-secret')
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('checks the catalog without a completion and detects unavailable role models', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('https://llmost.ru/api/v1/models')
      return Response.json({ data: [{ id: 'analyst' }] })
    }) as typeof fetch
    expect((await new LlmostProvider({
      ...options,
      fetchImpl,
    }).health()).available).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('rejects insecure endpoints and makes no requests when the key is missing', async () => {
    expect(() => new LlmostProvider({
      ...options,
      baseUrl: 'http://llmost.ru/api/v1',
    })).toThrow('HTTPS')
    const fetchImpl = vi.fn() as typeof fetch
    const provider = new LlmostProvider({
      ...options,
      apiKey: '',
      fetchImpl,
    })
    expect((await provider.health()).available).toBe(false)
    await expect(provider.run(request)).rejects.toThrow('required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
