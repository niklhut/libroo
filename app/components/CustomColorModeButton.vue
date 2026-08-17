<script lang="ts" setup>
const colorMode = useColorMode()

const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (val: boolean) => {
    const newPreference = val ? 'dark' : 'light'

    // Check if the new preference matches the system preference
    const systemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    if (newPreference === systemPreference) {
      // If the new preference matches system, set to 'system' instead
      colorMode.preference = 'system'
    } else {
      // Otherwise, set the explicit preference
      colorMode.preference = newPreference
    }
  }
})

function toggleColorMode() {
  isDark.value = !isDark.value
}
</script>

<template>
  <ClientOnly>
    <UButton
      color="neutral"
      variant="link"
      :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
      aria-label="Toggle color mode"
      @click.stop="toggleColorMode"
    />
    <template #fallback>
      <slot name="fallback">
        <div class="size-8" />
      </slot>
    </template>
  </ClientOnly>
</template>
