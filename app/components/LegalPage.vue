<script setup lang="ts">
defineProps<{
  title: string
  description: string
  text: string
  errorMessage?: string
}>()
</script>

<template>
  <UContainer>
    <UPageHeader
      :title="title"
      :description="description"
    />

    <UPageBody>
      <UAlert
        v-if="errorMessage"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="This legal page could not be loaded."
        :description="errorMessage"
      />

      <UAlert
        v-else-if="!text"
        color="neutral"
        variant="soft"
        icon="i-lucide-file-text"
        title="No legal document has been published here yet."
        description="Please check back later."
      />

      <section
        v-else
        class="legal-markdown max-w-3xl wrap-break-word text-sm leading-7 text-default"
      >
        <Comark :markdown="text" />
      </section>
    </UPageBody>
  </UContainer>
</template>

<style scoped>
.legal-markdown :deep(h1),
.legal-markdown :deep(h2),
.legal-markdown :deep(h3) {
  margin-block: 1.75rem 0.75rem;
  font-weight: 700;
  line-height: 1.2;
}

.legal-markdown :deep(h1) {
  font-size: 1.5rem;
}

.legal-markdown :deep(h2) {
  font-size: 1.25rem;
}

.legal-markdown :deep(h3) {
  font-size: 1.05rem;
}

.legal-markdown :deep(p),
.legal-markdown :deep(ul),
.legal-markdown :deep(ol),
.legal-markdown :deep(blockquote) {
  margin-block: 0.75rem;
}

.legal-markdown :deep(ul),
.legal-markdown :deep(ol) {
  padding-inline-start: 1.25rem;
}

.legal-markdown :deep(ul) {
  list-style: disc;
}

.legal-markdown :deep(ol) {
  list-style: decimal;
}

.legal-markdown :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 0.18em;
}

.legal-markdown :deep(code) {
  border-radius: 0.25rem;
  background: var(--ui-bg-muted);
  padding: 0.1rem 0.3rem;
  font-size: 0.9em;
}

.legal-markdown :deep(blockquote) {
  border-inline-start: 3px solid var(--ui-border);
  color: var(--ui-text-muted);
  padding-inline-start: 1rem;
}
</style>
