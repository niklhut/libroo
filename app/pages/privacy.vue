<script setup lang="ts">
import type { LegalDocument } from '~~/shared/types/legal'

definePageMeta({
  auth: false
})

const config = useRuntimeConfig()
const externalUrl = configuredLegalUrl(config.public.legalPrivacyPolicyUrl)

if (externalUrl) {
  await navigateTo(externalUrl, { external: true })
}

const { data, error } = await useFetch<LegalDocument>('/api/legal/privacy', {
  default: () => ({
    markdown: null,
    configured: false
  })
})

const text = computed(() => data.value?.markdown ?? '')
const errorMessage = computed(() => error.value
  ? 'Check NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL and make sure the Markdown source is reachable by the server.'
  : '')

useHead({
  title: 'Privacy Policy'
})
</script>

<template>
  <LegalPage
    title="Privacy Policy"
    description="Privacy information for Libroo."
    :text="text"
    :error-message="errorMessage"
  />
</template>
