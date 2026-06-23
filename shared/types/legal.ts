export type LegalDocumentKind = 'privacy' | 'imprint' | 'terms'

export interface LegalDocument {
  markdown: string | null
  configured: boolean
}

export interface LegalStatus {
  privacy: boolean
  imprint: boolean
  terms: boolean
}
