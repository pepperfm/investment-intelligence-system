import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Environment whitelist for agent processes. Broker secrets (NUXT_FINAM_*), database and Redis URLs,
 * the auth secret and any other variable are never inherited.
 */
const ALLOWED_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'CODEX_HOME', 'SHELL']
const FORBIDDEN_PATTERN = /FINAM|SECRET|TOKEN|PASSWORD|DATABASE|REDIS|AUTH|API_KEY/i

export function agentEnv(source: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const key of ALLOWED_ENV) {
    const value = source[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (FORBIDDEN_PATTERN.test(key)) {
      throw new Error(`Refusing to pass ${key} to an agent process`)
    }
    env[key] = value
  }
  return env
}

export interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export function runProcess(bin: string, args: string[], options: {
  cwd: string
  input?: string
  timeoutMs: number
  env: Record<string, string>
}) {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }, options.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > 5_000_000) {
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-20_000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code,
        stdout,
        stderr,
        timedOut,
      })
    })
    child.stdin.end(options.input ?? '')
  })
}

/** Fresh empty directory outside the repository: the agent's working root contains nothing but what we write. */
export async function withIsolatedWorkdir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), 'iis-agent-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
    })
  }
}
