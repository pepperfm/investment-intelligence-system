import { createHash } from 'node:crypto'

export const contentHash = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex')

export class SourceHttpError extends Error {
  constructor(readonly code: string, readonly status: number | null = null, readonly retryAfterMs: number | null = null) {
    super(code)
  }
}

export interface SourceResponse {
  body: string
  status: number
  observedAt: string
  hash: string
  durationMs: number
  etag: string | null
  lastModified: string | null
  cached: boolean
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
  /** Only documented read-only SOAP operations may retry POST. */
  idempotent?: boolean
}

/** Bounded, serial, cache-first transport. Stale cache is never silently returned on failure. */
export class EvidenceHttpClient {
  private cache = new Map<string, {
    response: SourceResponse
    expires: number
  }>()

  private queue: Promise<unknown> = Promise.resolve()
  private lastRequest = 0

  constructor(
    private fetchImpl: typeof fetch = fetch,
    private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    private minIntervalMs = 350,
    private cacheMs = 15 * 60_000,
  ) {}

  request(url: string, options: RequestOptions = {}): Promise<SourceResponse> {
    const task = this.queue.then(() => this.perform(url, options))
    this.queue = task.catch(() => undefined)
    return task
  }

  private async perform(url: string, options: RequestOptions): Promise<SourceResponse> {
    const key = contentHash(JSON.stringify([url, options.method ?? 'GET', options.body ?? '']))
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) {
      return {
        ...cached.response,
        cached: true,
      }
    }
    const headers: Record<string, string> = {
      'user-agent': 'IIS/1.0 (personal research; read-only)',
      ...options.headers,
    }
    if (cached?.response.etag) {
      headers['if-none-match'] = cached.response.etag
    }
    if (cached?.response.lastModified) {
      headers['if-modified-since'] = cached.response.lastModified
    }
    const started = Date.now()
    const attempts = options.method !== 'POST' || options.idempotent ? 3 : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.sleep(Math.max(0, this.minIntervalMs - (Date.now() - this.lastRequest)))
      this.lastRequest = Date.now()
      try {
        const response = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          body: options.body,
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        })
        if (response.status === 304 && cached) {
          this.cache.set(key, {
            response: cached.response,
            expires: Date.now() + this.cacheMs,
          })
          return {
            ...cached.response,
            cached: true,
            status: 304,
          }
        }
        if (!response.ok) {
          await response.body?.cancel()
          const retryAfter = response.headers.get('retry-after')
          let retryAfterMs: number | null = null
          if (retryAfter) {
            retryAfterMs = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())
          }
          throw new SourceHttpError(`http_${response.status}`, response.status, retryAfterMs)
        }
        const reader = response.body?.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        if (!reader) {
          throw new SourceHttpError('empty_response')
        }
        while (true) {
          const part = await reader.read()
          if (part.done) {
            break
          }
          length += part.value.length
          if (length > 4_000_000) {
            await reader.cancel()
            throw new SourceHttpError('response_too_large')
          }
          chunks.push(part.value)
        }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        const charset = /charset=([^;\s]+)/i.exec(response.headers.get('content-type') ?? '')?.[1]
          ?? (/encoding=["']windows-1251/i.test(new TextDecoder().decode(bytes.slice(0, 150))) ? 'windows-1251' : 'utf-8')
        const body = new TextDecoder(charset).decode(bytes)
        const result: SourceResponse = {
          body,
          status: response.status,
          observedAt: new Date().toISOString(),
          hash: contentHash(body),
          durationMs: Date.now() - started,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          cached: false,
        }
        this.cache.set(key, {
          response: result,
          expires: Date.now() + this.cacheMs,
        })
        // Bounded process-local cache; durable payload audit belongs to source_fetches.
        if (this.cache.size > 100) {
          this.cache.delete(this.cache.keys().next().value!)
        }
        return result
      } catch (error) {
        const failure = error instanceof SourceHttpError ? error : new SourceHttpError('network_or_timeout')
        const retryable = failure.status === 429 || (failure.status !== null && failure.status >= 500) || failure.code === 'network_or_timeout'
        if (!retryable || attempt === attempts - 1 || (failure.retryAfterMs !== null && failure.retryAfterMs > 5000)) {
          throw failure
        }
        await this.sleep(Math.max(failure.retryAfterMs ?? 0, Math.min(4000, 500 * 2 ** attempt + Math.floor(Math.random() * 200))))
      }
    }
    throw new SourceHttpError('request_failed')
  }
}
