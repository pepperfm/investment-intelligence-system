import { load } from 'cheerio'

export function parseXml(body: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) {
    throw new Error('XML entities are not allowed')
  }
  const $ = load(body, { xmlMode: true })
  // Namespace prefixes are arbitrary in SOAP; match XML local names structurally.
  $('*').each((_index, node) => {
    if (node.type === 'tag') {
      node.name = node.name.split(':').at(-1)!
    }
  })
  if ($('Fault').length) {
    throw new Error('CBR SOAP fault')
  }
  return $
}

export function soapEnvelope(operation: string, params: Record<string, string>) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${operation} xmlns="http://web.cbr.ru/">${Object.entries(params).map(([key, value]) => `<${key}>${escape(value)}</${key}>`).join('')}</${operation}></soap:Body></soap:Envelope>`
}
