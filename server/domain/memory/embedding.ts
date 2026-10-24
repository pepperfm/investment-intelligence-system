export const HASH_EMBEDDING_MODEL = 'hash-v1-256'

function fnv1a(input: string) {
  let hash = 0x811C9DC5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function tokenize(text: string) {
  return text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.filter(t => t.length > 1) ?? []
}

/**
 * Local deterministic embedding via signed feature hashing of unigrams, bigrams and character trigrams.
 * Lexical rather than semantic, but fully offline and stable; replaceable by an API model (reindex).
 */
export function hashEmbedding(text: string, dimensions = 256) {
  const vector = Array.from({ length: dimensions }, () => 0)
  const tokens = tokenize(text)
  const add = (feature: string, weight: number) => {
    const h = fnv1a(feature)
    vector[h % dimensions]! += (h & 0x80000000 ? -1 : 1) * weight
  }
  tokens.forEach((token, i) => {
    add(`u:${token}`, 1)
    if (i > 0) {
      add(`b:${tokens[i - 1]}_${token}`, 0.7)
    }
    const stem = token.slice(0, 6)
    for (let j = 0; j + 3 <= stem.length; j++) {
      add(`c:${stem.slice(j, j + 3)}`, 0.3)
    }
  })
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0))
  return norm ? vector.map(v => v / norm) : vector
}

export function cosine(a: number[], b: number[]) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
