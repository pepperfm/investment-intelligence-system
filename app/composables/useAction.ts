/** Runs a mutating request with pending state and toast feedback. */
export function useAction() {
  const toast = useToast()
  const pending = ref(false)
  async function run<T>(fn: () => Promise<T>, success?: string | ((result: T) => string)) {
    if (pending.value) {
      return
    }
    pending.value = true
    try {
      const result = await fn()
      if (success) {
        toast.add({
          title: typeof success === 'function' ? success(result) : success,
          color: 'success',
        })
      }
      return result
    } catch (error) {
      toast.add({
        title: 'Ошибка',
        description: apiError(error),
        color: 'error',
      })
    } finally {
      pending.value = false
    }
  }
  return {
    pending,
    run,
  }
}
