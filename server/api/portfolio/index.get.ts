import { portfolioOverview } from '../../trading/paper-broker'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return portfolioOverview()
})
