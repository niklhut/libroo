export type LegalDocumentKind = 'privacy' | 'imprint'

export interface LegalDocument {
  markdown: string | null
  configured: boolean
}

export interface LegalStatus {
  privacy: boolean
  imprint: boolean
}
