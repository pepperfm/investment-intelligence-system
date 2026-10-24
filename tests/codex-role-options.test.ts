import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CodexProvider } from '../server/ai/codex-provider'
import { runProcess } from '../server/ai/process'

vi.mock('../server/ai/process', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/ai/process')>()
  return {
    ...original,
    runProcess: vi.fn(async () => ({
      code: 0,
      stdout: '{"ok":true}',
      stderr: '',
      timedOut: false,
    })),
  }
})

describe('Codex per-role settings', () => {
  it('passes the exact role model/effort to the CLI and preserves isolated execution', async () => {
    const provider = new CodexProvider({
      bin: 'codex',
      model: 'fallback',
      reasoningEffort: 'low',
      timeoutMs: 1000,
      roles: {
        hypothesis_critic: {
          model: 'gpt-6-astra',
          reasoningEffort: 'high',
        },
        market_researcher: {
          model: 'gpt-6-luna',
          reasoningEffort: 'medium',
        },
      },
    })
    for (const [role, model, effort] of [
      ['hypothesis_critic', 'gpt-6-astra', 'high'],
      ['market_researcher', 'gpt-6-luna', 'medium'],
      ['outcome_reviewer', 'fallback', 'low'],
    ] as const) {
      await provider.run({
        role,
        task: 'test',
        packet: {},
        schema: z.object({ ok: z.boolean() }),
      })
      const [, args, options] = vi.mocked(runProcess).mock.calls.at(-1)!
      expect(args[args.indexOf('-m') + 1]).toBe(model)
      expect(args).toContain(`model_reasoning_effort="${effort}"`)
      expect(args).toContain('--ignore-user-config')
      expect(args).toContain('--ignore-rules')
      expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
      expect(options.env).not.toHaveProperty('TRADE_API_SECRET')
      expect(options.cwd).not.toBe(process.cwd())
    }
  })
})
