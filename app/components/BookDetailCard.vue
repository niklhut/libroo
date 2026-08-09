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

const toneClasses: Record<BookDetailCardTone, { card: string, icon: string, iconColor: string }> = {
  primary: {
    card: 'border-l-primary/70 bg-primary/[0.03]',
    icon: 'border-primary/30 bg-primary/10',
    iconColor: 'text-primary'
  },
  success: {
    card: 'border-l-emerald-500/70 bg-emerald-500/[0.03]',
    icon: 'border-emerald-500/30 bg-emerald-500/10',
    iconColor: 'text-emerald-700 dark:text-emerald-300'
  },
  warning: {
    card: 'border-l-amber-500/70 bg-amber-500/[0.03]',
    icon: 'border-amber-500/30 bg-amber-500/10',
    iconColor: 'text-amber-700 dark:text-amber-300'
  },
  secondary: {
    card: 'border-l-violet-500/70 bg-violet-500/[0.03]',
    icon: 'border-violet-500/30 bg-violet-500/10',
    iconColor: 'text-violet-700 dark:text-violet-300'
  }
}

const bodyClasses: Record<BookDetailCardSize, string> = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6'
}
</script>

<template>
  <UCard
    :class="['border-l-4', toneClasses[props.tone].card]"
    :ui="{
      root: 'ring-0 divide-y-0',
      body: bodyClasses[props.size]
    }"
  >
    <div class="flex gap-3">
      <div
        :class="['flex size-10 shrink-0 items-center justify-center border', toneClasses[props.tone].icon]"
      >
        <UIcon
          :name="icon"
          :class="['size-5', toneClasses[props.tone].iconColor]"
        />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">
              {{ title }}
            </h2>
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
