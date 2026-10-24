import { toWebRequest } from 'h3'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return auth().handler(toWebRequest(event))
})
