<script setup lang="ts">
import type { LegalStatus } from '~~/shared/types/legal'

const config = useRuntimeConfig()
const { data: legalStatus } = await useFetch<LegalStatus>('/api/legal/status')

const privacyPolicyUrl = computed(() => configuredLegalUrl(config.public.legalPrivacyPolicyUrl))
const imprintUrl = computed(() => configuredLegalUrl(config.public.legalImprintUrl))
const termsUrl = computed(() => configuredLegalUrl(config.public.legalTermsUrl))
const privacyPolicyConfigured = computed(() =>
  privacyPolicyUrl.value || legalStatus.value?.privacy
)
const imprintConfigured = computed(() =>
  imprintUrl.value || legalStatus.value?.imprint
)
const termsConfigured = computed(() =>
  termsUrl.value || legalStatus.value?.terms
)

const links = computed(() => [
  ...(privacyPolicyConfigured.value
    ? [{
        label: 'Privacy',
        to: privacyPolicyUrl.value || '/privacy',
        external: Boolean(privacyPolicyUrl.value)
      }]
    : []),
  ...(imprintConfigured.value
    ? [{
        label: 'Imprint',
        to: imprintUrl.value || '/imprint',
        external: Boolean(imprintUrl.value)
      }]
    : []),
  ...(termsConfigured.value
    ? [{
        label: 'Terms',
        to: termsUrl.value || '/terms',
        external: Boolean(termsUrl.value)
      }]
    : [])
])
</script>

<template>
  <footer
    v-if="links.length"
    class="border-t border-default"
  >
    <UContainer class="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-muted">
      <span>Libroo</span>

      <nav
        class="flex flex-wrap items-center gap-x-4 gap-y-2"
        aria-label="Legal"
      >
        <ULink
          v-for="link in links"
          :key="link.label"
          :to="link.to"
          :target="link.external ? '_blank' : undefined"
          :rel="link.external ? 'noopener noreferrer' : undefined"
          class="hover:text-default"
        >
          {{ link.label }}
        </ULink>
      </nav>
    </UContainer>
  </footer>
</template>
