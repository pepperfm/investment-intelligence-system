/** Validate bytes before persistence; files are never executed, rendered as HTML or fetched by supplied URL. */
export function documentMime(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > 20_000_000) {
    throw new Error('Document must be between 1 byte and 20 MB')
  }
  const prefix = new TextDecoder().decode(bytes.slice(0, 200)).trimStart().toLowerCase()
  if (prefix.startsWith('%pdf-')) {
    return 'application/pdf'
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (prefix.startsWith('<!doctype html') || prefix.startsWith('<html')) {
    return 'text/html'
  }
  throw new Error('Supported document formats: PDF, XLSX, HTML')
}
