/** Read-only view of the real broker account (Finam). Never used for order placement. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const provider = marketProvider()
  if (provider.id !== 'finam') {
    return {
      configured: false,
      account: null,
    }
  }
  return {
    configured: true,
    account: await provider.getAccount(),
  }
})
