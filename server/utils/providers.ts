import { ClaudeProvider } from '../ai/claude-provider'
import { CodexProvider } from '../ai/codex-provider'
import { MockProvider } from '../ai/mock-provider'
import { LlmostProvider } from '../ai/llmost-provider'
import { getAiProfile } from '../services/settings'
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

export async function selectedAgentProviders() {
  const config = useRuntimeConfig()
  const profile = await getAiProfile()
  return {
    profile,
    analyst: providerById(profile === 'llmost' ? 'llmost' : config.aiProvider),
    critic: providerById(profile === 'llmost' ? 'llmost' : config.aiCriticProvider),
  }
}

export async function agentProvider(kind: 'analyst' | 'critic'): Promise<AgentProvider> {
  const providers = await selectedAgentProviders()
  return providers[kind]
}

export function providerById(value: string): AgentProvider {
  const id = parseProvider(value)
  const existing = agents.get(id)
  if (existing) {
    return existing
  }
  const config = useRuntimeConfig()
  const timeoutMs = Number(config.aiTimeoutMs) || 600_000
  if (id === 'llmost') {
    const provider = new LlmostProvider({
      baseUrl: config.llmostBaseUrl,
      apiKey: config.llmostApiKey,
      timeoutMs,
      roles: {
        market_researcher: {
          model: config.llmostResearcherModel,
          effort: config.llmostResearcherEffort,
        },
        hypothesis_analyst: {
          model: config.llmostAnalystModel,
          effort: config.llmostAnalystEffort,
        },
        hypothesis_critic: {
          model: config.llmostCriticModel,
          effort: config.llmostCriticEffort,
        },
        outcome_reviewer: {
          model: config.llmostReviewerModel,
          effort: config.llmostReviewerEffort,
        },
      },
    })
    agents.set(id, provider)
    return provider
  }
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
  if (value === 'codex' || value === 'claude' || value === 'llmost' || value === 'mock') {
    return value
  }
  throw new Error(`Unknown AI provider "${value}"`)
}
