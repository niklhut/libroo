<script setup lang="ts">
import type { LegalDocument } from '~~/shared/types/legal'

definePageMeta({
  auth: false
})

const config = useRuntimeConfig()
const externalUrl = configuredLegalUrl(config.public.legalImprintUrl)

if (externalUrl) {
  await navigateTo(externalUrl, { external: true })
}

const { data, error } = await useFetch<LegalDocument>('/api/legal/imprint', {
  default: () => ({
    markdown: null,
    configured: false
  })
})

const text = computed(() => data.value?.markdown ?? '')
const errorMessage = computed(() => error.value
  ? 'Check NUXT_LEGAL_IMPRINT_MARKDOWN_URL and make sure the Markdown source is reachable by the server.'
  : '')

useHead({
  title: 'Imprint'
})
</script>

<template>
  <LegalPage
    title="Imprint"
    description="Legal notice for Libroo."
    :text="text"
    :error-message="errorMessage"
  />
</template>
