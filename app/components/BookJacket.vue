<script setup lang="ts">
const props = defineProps<{ title: string, author: string }>()

const jacketClass = computed(() => {
  const palettes = [
    'from-slate-800 via-slate-700 to-stone-900',
    'from-indigo-950 via-indigo-900 to-slate-950',
    'from-emerald-950 via-teal-900 to-slate-950',
    'from-rose-950 via-red-900 to-stone-950',
    'from-amber-950 via-stone-700 to-stone-950',
    'from-violet-950 via-purple-900 to-slate-950'
  ]
  const hash = [...props.title].reduce((value, character) => (value + character.charCodeAt(0)) % palettes.length, 0)
  return palettes[hash]
})
</script>

<template>
  <div
    aria-hidden="true"
    class="absolute inset-0 flex flex-col justify-between bg-linear-to-br p-4 pb-12 text-white sm:p-5 sm:pb-12"
    :class="jacketClass"
    data-testid="book-jacket"
    :data-jacket-palette="jacketClass"
  >
    <div
      class="absolute inset-y-0 left-2 w-px bg-white/15"
      aria-hidden="true"
    />
    <div class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
      <NuxtImg
        src="/Libroo_Icon.svg"
        alt=""
        width="16"
        height="16"
        class="size-4 shrink-0 brightness-0 invert opacity-60"
      />
      Libroo library
    </div>
    <p class="break-words font-serif text-xl leading-tight font-medium line-clamp-4 sm:text-2xl">
      {{ title }}
    </p>
    <p class="text-xs leading-4 text-white/65 line-clamp-2">
      {{ author || 'Unknown author' }}
    </p>
  </div>
</template>
