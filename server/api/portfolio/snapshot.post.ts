import { paperAccount, takeSnapshot } from '../../trading/paper-broker'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return takeSnapshot((await paperAccount()).id)
})
