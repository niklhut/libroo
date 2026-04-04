<script setup lang="ts">
interface Props {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
}

withDefaults(defineProps<Props>(), {
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel'
})

const emit = defineEmits<{
  confirm: []
}>()

const isOpen = ref(false)

function openDialog() {
  isOpen.value = true
}

function closeDialog() {
  isOpen.value = false
}

function confirmDialog() {
  isOpen.value = false
  emit('confirm')
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="title"
    :description="description"
    :close="false"
    :ui="{
      footer: 'justify-end gap-3'
    }"
  >
    <template #default>
      <slot
        name="trigger"
        :open="openDialog"
      />
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        @click="closeDialog"
      >
        {{ cancelLabel }}
      </UButton>
      <UButton
        color="error"
        icon="i-lucide-trash-2"
        @click="confirmDialog"
      >
        {{ confirmLabel }}
      </UButton>
    </template>
  </UModal>
</template>
