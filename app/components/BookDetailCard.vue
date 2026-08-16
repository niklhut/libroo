<script setup lang="ts">
type BookDetailCardTone = 'primary' | 'success' | 'warning' | 'secondary'
type BookDetailCardSize = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  title: string
  icon: string
  description?: string
  tone?: BookDetailCardTone
  size?: BookDetailCardSize
}>(), {
  tone: 'primary',
  size: 'md'
})

const toneClasses: Record<BookDetailCardTone, { icon: string, iconColor: string }> = {
  primary: {
    icon: 'border-primary/30 bg-primary/10',
    iconColor: 'text-primary'
  },
  success: {
    icon: 'border-emerald-500/30 bg-emerald-500/10',
    iconColor: 'text-emerald-700 dark:text-emerald-300'
  },
  warning: {
    icon: 'border-amber-500/30 bg-amber-500/10',
    iconColor: 'text-amber-700 dark:text-amber-300'
  },
  secondary: {
    icon: 'border-violet-500/30 bg-violet-500/10',
    iconColor: 'text-violet-700 dark:text-violet-300'
  }
}

const bodyClasses: Record<BookDetailCardSize, string> = {
  sm: 'px-0 py-3',
  md: 'px-0 py-4',
  lg: 'px-0 py-5'
}
</script>

<template>
  <UCard
    as="section"
    :aria-label="title"
    class="rounded-none border-0 border-b border-default bg-transparent shadow-none"
    :ui="{
      root: 'ring-0 divide-y-0',
      body: bodyClasses[props.size]
    }"
  >
    <div class="flex gap-4">
      <div
        :class="['flex size-10 shrink-0 items-center justify-center border', toneClasses[props.tone].icon]"
      >
        <UIcon
          :name="icon"
          :class="['size-5', toneClasses[props.tone].iconColor]"
        />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base font-semibold">
                {{ title }}
              </h2>
              <slot name="title-suffix" />
            </div>
            <p
              v-if="description"
              class="mt-1 text-sm text-muted"
            >
              {{ description }}
            </p>
          </div>
          <slot name="action" />
        </div>
        <slot />
      </div>
    </div>
    <slot name="footer" />
  </UCard>
</template>
