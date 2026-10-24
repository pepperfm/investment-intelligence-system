import { ClaudeProvider } from '../ai/claude-provider'
import { CodexProvider } from '../ai/codex-provider'
import { MockProvider } from '../ai/mock-provider'
import type { AgentProvider, ProviderId } from '../ai/provider'
import { FinamMarketDataProvider } from '../adapters/market/finam'
import { MockMarketDataProvider } from '../adapters/market/mock'
import type { MarketDataProvider } from '../adapters/market/types'

let market: MarketDataProvider | undefined
const agents = new Map<ProviderId, AgentProvider>()

export function marketProvider(): MarketDataProvider {
  if (market) {
    return market
  }
  const config = useRuntimeConfig()
  market = config.marketProvider === 'finam'
    ? new FinamMarketDataProvider({
        secret: config.finamReadSecret,
        accountId: config.finamAccountId,
        symbols: config.finamSymbols.split(',').map(s => s.trim()).filter(Boolean),
      })
    : new MockMarketDataProvider()
  return market
}

export function agentProvider(kind: 'analyst' | 'critic'): AgentProvider {
  const config = useRuntimeConfig()
  const id = parseProvider(kind === 'analyst' ? config.aiProvider : config.aiCriticProvider)
  return providerById(id)
}

export function providerById(id: ProviderId): AgentProvider {
  const existing = agents.get(id)
  if (existing) {
    return existing
  }
  const config = useRuntimeConfig()
  const timeoutMs = Number(config.aiTimeoutMs) || 600_000
  const provider = id === 'codex'
    ? new CodexProvider({
        bin: config.codexBin,
        model: config.codexModel || undefined,
        reasoningEffort: parseEffort(config.codexReasoningEffort),
        roles: {
          market_researcher: {
            model: config.codexResearcherModel || undefined,
            reasoningEffort: parseEffort(config.codexResearcherEffort),
          },
          hypothesis_analyst: {
            model: config.codexAnalystModel || undefined,
            reasoningEffort: parseEffort(config.codexAnalystEffort),
          },
          hypothesis_critic: {
            model: config.codexCriticModel || undefined,
            reasoningEffort: parseEffort(config.codexCriticEffort),
          },
          outcome_reviewer: {
            model: config.codexReviewerModel || undefined,
            reasoningEffort: parseEffort(config.codexReviewerEffort),
          },
        },
        timeoutMs,
      })
    : id === 'claude'
      ? new ClaudeProvider({
          bin: config.claudeBin,
          model: config.claudeModel || undefined,
          timeoutMs,
        })
      : new MockProvider()
  agents.set(id, provider)
  return provider
}

function parseEffort(value: string) {
  if (!value) {
    return undefined
  }
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  throw new Error(`Unknown NUXT_CODEX_REASONING_EFFORT "${value}"`)
}

function parseProvider(value: string): ProviderId {
  if (value === 'codex' || value === 'claude' || value === 'mock') {
    return value
  }
  throw new Error(`Unknown AI provider "${value}"`)
}
