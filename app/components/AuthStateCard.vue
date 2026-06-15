<script setup lang="ts">
type ActionTo = string | Record<string, unknown>

const props = withDefaults(defineProps<{
  icon: string
  title: string
  description?: string
  actionLabel?: string
  actionTo?: ActionTo
  actionIcon?: string
}>(), {
  description: '',
  actionLabel: '',
  actionTo: undefined,
  actionIcon: undefined
})
</script>

<template>
  <UPageCard>
    <UAuthForm
      :title="props.title"
      :description="props.description"
      :icon="props.icon"
    >
      <template #footer>
        <div class="space-y-6 text-base">
          <UButton
            v-if="props.actionTo && props.actionLabel"
            :to="props.actionTo"
            :icon="props.actionIcon"
            block
            size="lg"
          >
            {{ props.actionLabel }}
          </UButton>

          <p class="text-center text-sm text-muted">
            Libroo - Your Library, Managed
          </p>
        </div>
      </template>
    </UAuthForm>
  </UPageCard>
</template>
