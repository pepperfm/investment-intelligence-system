import type { ManualDocumentInput } from '../../../../shared/schemas/evidence'

export interface VerifiedIssuerDocument {
  metadata: ManualDocumentInput
  bytes: Uint8Array
  publicationVerified?: boolean
  extractorVersion: string
}

export interface IssuerDisclosureProvider {
  discoverIssuer(inn: string): {
    inn: string
    name: string
  } | null
  listReports(inn: string): {
    id: string
    title: string
    sourceUrl: string
  }[]
  fetchDocument(id: string): Promise<Uint8Array>
  extractFacts(id: string, bytes: Uint8Array, instrumentId: string, pdfBin?: string): Promise<VerifiedIssuerDocument>
}
