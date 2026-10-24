import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strictJsonSchema } from './contracts'
import { agentEnv, runProcess, withIsolatedWorkdir } from './process'
import { AgentOutputError, buildPrompt, extractJson, type AgentProvider, type AgentRequest, type AgentResult, type ProviderHealth } from './provider'
import { loadRole } from './roles'

export interface CodexOptions {
  bin: string
  model?: string
  /** Passed explicitly because --ignore-user-config drops the user's ~/.codex defaults. */
  reasoningEffort?: 'low' | 'medium' | 'high'
  timeoutMs: number
}

/**
 * Each role runs as its own `codex exec` process: independent context, read-only sandbox,
 * no user config (so no inherited MCP servers/tools), ephemeral session, isolated empty workdir.
 */
export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const

  constructor(private readonly options: CodexOptions) {}

  async health(): Promise<ProviderHealth> {
    try {
      const result = await runProcess(this.options.bin, ['--version'], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
        env: agentEnv(),
      })
      if (result.code !== 0) {
        return {
          id: this.id,
          available: false,
          version: null,
          error: result.stderr.trim() || `exit ${result.code}`,
        }
      }
      return {
        id: this.id,
        available: true,
        version: result.stdout.trim(),
        error: null,
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
      const schemaPath = join(dir, 'schema.json')
      const outPath = join(dir, 'last-message.json')
      await writeFile(schemaPath, JSON.stringify(strictJsonSchema(request.schema)))
      const args = [
        'exec',
        '--sandbox', 'read-only',
        '--skip-git-repo-check',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--color', 'never',
        '--output-schema', schemaPath,
        '-o', outPath,
        '-C', dir,
      ]
      if (this.options.model) {
        args.push('-m', this.options.model)
      }
      if (this.options.reasoningEffort) {
        args.push('-c', `model_reasoning_effort="${this.options.reasoningEffort}"`)
      }
      args.push('-')
      const result = await runProcess(this.options.bin, args, {
        cwd: dir,
        input: buildPrompt(role.developerInstructions, request.task, request.packet),
        timeoutMs: this.options.timeoutMs,
        env: agentEnv(),
      })
      if (result.timedOut) {
        throw new AgentOutputError(`codex ${request.role} timed out`, result.stderr)
      }
      if (result.code !== 0) {
        throw new AgentOutputError(`codex ${request.role} exited with ${result.code}: ${result.stderr.slice(-500)}`, result.stderr)
      }
      const text = await readFile(outPath, 'utf8').catch(() => result.stdout)
      let raw: unknown
      try {
        raw = extractJson(text)
      } catch {
        throw new AgentOutputError(`codex ${request.role} returned non-JSON output`, text.slice(0, 5000))
      }
      const parsed = request.schema.safeParse(raw)
      if (!parsed.success) {
        throw new AgentOutputError(`codex ${request.role} output failed schema validation: ${parsed.error.message.slice(0, 500)}`, raw)
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
