import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRole } from './contracts'

export interface RoleDefinition {
  name: string
  description: string
  developerInstructions: string
}

/** Minimal reader for the three keys used in .codex/agents/*.toml (basic and multi-line basic strings). */
export function parseRoleToml(source: string): RoleDefinition {
  const read = (key: string) => {
    const multi = source.match(new RegExp(`^${key}\\s*=\\s*"""\\n?([\\s\\S]*?)"""`, 'm'))
    if (multi) {
      return multi[1]!.trim()
    }
    const single = source.match(new RegExp(`^${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'm'))
    return single ? JSON.parse(`"${single[1]}"`) as string : ''
  }
  const role = {
    name: read('name'),
    description: read('description'),
    developerInstructions: read('developer_instructions'),
  }
  if (!role.name || !role.developerInstructions) {
    throw new Error('Role TOML must define name and developer_instructions')
  }
  return role
}

const cache = new Map<AgentRole, RoleDefinition>()

export async function loadRole(role: AgentRole, rootDir = process.cwd()) {
  const cached = cache.get(role)
  if (cached) {
    return cached
  }
  const definition = parseRoleToml(await readFile(join(rootDir, '.codex', 'agents', `${role}.toml`), 'utf8'))
  cache.set(role, definition)
  return definition
}
