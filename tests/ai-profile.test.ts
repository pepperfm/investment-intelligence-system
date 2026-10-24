import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAiProfile } from '../server/services/settings'
import { providerById, selectedAgentProviders } from '../server/utils/providers'

vi.mock('../server/services/settings', () => ({ getAiProfile: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

describe('manual AI profiles', () => {
  it('resolves one profile per run, preserving previously selected providers after a switch', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      aiProvider: 'codex',
      aiCriticProvider: 'claude',
      codexBin: 'codex',
      claudeBin: 'claude',
      aiTimeoutMs: 1000,
      llmostBaseUrl: 'https://llmost.ru/api/v1',
      llmostApiKey: 'test-key',
      llmostResearcherModel: 'research',
      llmostAnalystModel: 'analyst',
      llmostCriticModel: 'critic',
      llmostReviewerModel: 'review',
    }))
    vi.mocked(getAiProfile).mockResolvedValueOnce('primary').mockResolvedValueOnce('llmost')
    const original = await selectedAgentProviders()
    expect(original.analyst.id).toBe('codex')
    expect(original.critic.id).toBe('claude')
    const reserve = await selectedAgentProviders()
    expect(reserve.analyst.id).toBe('llmost')
    expect(reserve.critic.id).toBe('llmost')
    expect(original.analyst.id).toBe('codex')
    expect(original.critic.id).toBe('claude')
    expect(getAiProfile).toHaveBeenCalledTimes(2)
    expect(providerById('llmost')).toBe(reserve.analyst)
  })
  it('never silently replaces an unknown provider with mock', () => {
    expect(() => providerById('llmost-typo')).toThrow('Unknown AI provider')
  })
})
