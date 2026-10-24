import { strictJsonSchema } from './contracts'
import { agentEnv, runProcess, withIsolatedWorkdir } from './process'
import { AgentOutputError, buildPrompt, extractJson, type AgentProvider, type AgentRequest, type AgentResult, type ProviderHealth } from './provider'
import { loadRole } from './roles'

export interface ClaudeOptions {
  bin: string
  model?: string
  timeoutMs: number
}

/** Cross-provider reviewer: `claude -p` with no tools, no MCP, no session persistence, isolated workdir. */
export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const

  constructor(private readonly options: ClaudeOptions) {}

  async health(): Promise<ProviderHealth> {
    try {
      const result = await runProcess(this.options.bin, ['--version'], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
        env: agentEnv(),
      })
      return {
        id: this.id,
        available: result.code === 0,
        version: result.code === 0 ? result.stdout.trim() : null,
        error: result.code === 0 ? null : result.stderr.trim() || `exit ${result.code}`,
      }
    } catch (error) {
      return {
        id: this.id,
        available: false,
        version: null,
        error: (error as Error).message,
      }
    }
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    const role = await loadRole(request.role)
    const started = Date.now()
    return withIsolatedWorkdir(async (dir) => {
      const args = [
        '-p',
        '--output-format', 'json',
        '--json-schema', JSON.stringify(strictJsonSchema(request.schema)),
        '--tools', '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--setting-sources', '',
      ]
      if (this.options.model) {
        args.push('--model', this.options.model)
      }
      const result = await runProcess(this.options.bin, args, {
        cwd: dir,
        input: buildPrompt(role.developerInstructions, request.task, request.packet),
        timeoutMs: this.options.timeoutMs,
        env: agentEnv(),
      })
      if (result.timedOut || result.code !== 0) {
        throw new AgentOutputError(`claude ${request.role} failed: ${result.timedOut ? 'timeout' : result.stderr.slice(-500)}`, result.stderr)
      }
      let raw: unknown
      try {
        const envelope = JSON.parse(result.stdout) as {
          structured_output?: unknown
          result?: string
          is_error?: boolean
        }
        if (envelope.is_error) {
          throw new Error(envelope.result ?? 'error')
        }
        raw = envelope.structured_output ?? extractJson(envelope.result ?? '')
      } catch (error) {
        throw new AgentOutputError(`claude ${request.role} returned unusable output: ${(error as Error).message}`, result.stdout.slice(0, 5000))
      }
      const parsed = request.schema.safeParse(raw)
      if (!parsed.success) {
        throw new AgentOutputError(`claude ${request.role} output failed schema validation`, raw)
      }
      return {
        output: parsed.data,
        provider: this.id,
        durationMs: Date.now() - started,
        raw,
      }
    })
  }
}
