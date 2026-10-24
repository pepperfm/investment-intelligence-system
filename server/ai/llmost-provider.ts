import type { AgentRole } from './contracts'
import { strictJsonSchema } from './contracts'
import { AgentOutputError, buildPrompt, extractJson, type AgentProvider, type AgentRequest, type AgentResult, type ProviderHealth } from './provider'
import { loadRole } from './roles'

export interface LlmostRoleOptions {
  model: string
  effort?: string
}

export interface LlmostOptions {
  baseUrl: string
  apiKey: string
  roles: Record<AgentRole, LlmostRoleOptions>
  timeoutMs: number
  fetchImpl?: typeof fetch
}

/** One stateless HTTP call per role. No tools, process environment or automatic paid retries. */
export class LlmostProvider implements AgentProvider {
  readonly id = 'llmost' as const
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly options: LlmostOptions) {
    const url = new URL(options.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('LLMost base URL must use HTTPS without embedded credentials')
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private configured() {
    return Boolean(this.options.apiKey && Object.values(this.options.roles).every(role => role.model))
  }

  async health(): Promise<ProviderHealth> {
    const result: ProviderHealth = {
      id: this.id,
      available: false,
      version: null,
      error: null,
    }
    if (!this.configured()) {
      return {
        ...result,
        error: 'LLMost key and role models are required',
      }
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      })
      if (!response.ok) {
        return {
          ...result,
          error: `LLMost models: HTTP ${response.status}`,
        }
      }
      const body = await response.json() as { data?: { id: string }[] }
      const ids = new Set((body.data ?? []).map(model => model.id))
      const missing = Object.values(this.options.roles).filter(role => !ids.has(role.model))
      return {
        ...result,
        available: missing.length === 0,
        error: missing.length ? `LLMost model not in catalog: ${missing.map(role => role.model).join(', ')}` : null,
      }
    } catch {
      return {
        ...result,
        error: 'LLMost catalog is unreachable',
      }
    }
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    if (!this.configured()) {
      throw new AgentOutputError('LLMost key and role models are required', null)
    }
    const role = await loadRole(request.role)
    const model = this.options.roles[request.role]
    const started = Date.now()
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.options.timeoutMs),
      redirect: 'error',
      body: JSON.stringify({
        model: model.model,
        ...(model.effort ? { reasoning_effort: model.effort } : {}),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: request.role,
            strict: true,
            schema: strictJsonSchema(request.schema),
          },
        },
        stream: false,
        max_tokens: 8192,
        messages: [
          {
            role: 'system',
            content: `${role.developerInstructions}\nReturn JSON matching this schema:\n${JSON.stringify(strictJsonSchema(request.schema))}`,
          },
          {
            role: 'user',
            content: buildPrompt('', request.task, request.packet),
          },
        ],
      }),
    })
    // Never include a remote error body: it may echo credentials or the evidence packet.
    if (!response.ok) {
      throw new AgentOutputError(`LLMost ${request.role}: HTTP ${response.status}`, null)
    }
    let raw: unknown
    try {
      const body = await response.json() as {
        choices?: {
          finish_reason?: string
          message?: {
            content?: string
            tool_calls?: unknown[]
            refusal?: string
          }
        }[]
      }
      const choice = body.choices?.[0]
      if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length || choice.message?.refusal || typeof choice.message?.content !== 'string') {
        throw new Error('Incomplete or unsupported completion')
      }
      raw = extractJson(choice.message.content)
    } catch {
      throw new AgentOutputError(`LLMost ${request.role}: incomplete or invalid JSON response`, null)
    }
    const parsed = request.schema.safeParse(raw)
    if (!parsed.success) {
      throw new AgentOutputError(`LLMost ${request.role}: output failed schema validation`, null)
    }
    return {
      output: parsed.data,
      provider: this.id,
      durationMs: Date.now() - started,
      raw,
    }
  }
}
