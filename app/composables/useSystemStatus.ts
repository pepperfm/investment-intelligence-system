/** Shared, deduplicated status for the sidebar badges, status popover and pages. */
export function useSystemStatus() {
  return useFetch('/api/status', {
    key: 'system-status',
    dedupe: 'defer',
    getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
  })
}
