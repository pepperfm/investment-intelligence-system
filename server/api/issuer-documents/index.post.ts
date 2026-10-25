import { documentMime } from '../../domain/evidence/manual-document'
import { manualDocumentInput } from '../../../shared/schemas/evidence'
import { importIssuerDocument } from '../../services/issuer-fundamentals'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const length = Number(getHeader(event, 'content-length'))
  if (!Number.isFinite(length) || length <= 0 || length > 21_000_000) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Document upload exceeds 21 MB request limit',
    })
  }
  const parts = await readMultipartFormData(event)
  const metadata = parts?.find(part => part.name === 'metadata')
  const file = parts?.find(part => part.name === 'file')
  if (!metadata || !file || metadata.data.length > 250_000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'File and metadata are required',
    })
  }
  let json: unknown
  try {
    json = JSON.parse(metadata.data.toString('utf-8'))
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid metadata JSON',
    })
  }
  const input = manualDocumentInput.safeParse(json)
  if (!input.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid document metadata or unconfirmed facts',
    })
  }
  if (file.data.length === 0 || file.data.length > 20_000_000) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Document exceeds 20 MB limit',
    })
  }
  try {
    documentMime(file.data)
  } catch {
    throw createError({
      statusCode: 415,
      statusMessage: 'Unsupported document format',
    })
  }
  return importIssuerDocument(input.data, file.data)
})
