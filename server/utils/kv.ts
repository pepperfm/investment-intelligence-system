/** Durable non-secret key-value data; auth uses its own Redis namespace. */
export function kv() {
  return useStorage('kv')
}
