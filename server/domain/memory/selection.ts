export interface EventLike {
  title: string
  publishedAt: Date
}

/** Collapses repeated headlines (same normalised title) into the newest one with a repeat count. */
export function dedupeEvents<T extends EventLike>(events: T[]) {
  const groups = new Map<string, {
    event: T
    repeats: number
    firstSeen: Date
  }>()
  for (const event of [...events].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())) {
    const key = event.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const group = groups.get(key)
    if (group) {
      group.repeats++
      group.firstSeen = event.publishedAt
    } else {
      groups.set(key, {
        event,
        repeats: 1,
        firstSeen: event.publishedAt,
      })
    }
  }
  return [...groups.values()]
}

/**
 * Picks memory items so that winners and non-winners are both represented (by similarity within each group).
 * Prevents a retrieval set made only of successes, which would bias the analyst.
 */
export function balanceByOutcome<T extends {
  similarity: number
  outcome: string | null
}>(items: T[], limit: number) {
  const sorted = [...items].sort((a, b) => b.similarity - a.similarity)
  const wins = sorted.filter(i => i.outcome === 'win')
  const others = sorted.filter(i => i.outcome !== 'win')
  const result: T[] = []
  while (result.length < limit && (wins.length || others.length)) {
    const nextWin = wins[0]
    const nextOther = others[0]
    const takeOther = nextOther && (!nextWin || result.filter(r => r.outcome !== 'win').length <= result.filter(r => r.outcome === 'win').length)
    result.push((takeOther ? others.shift() : wins.shift())!)
  }
  return result.sort((a, b) => b.similarity - a.similarity)
}
