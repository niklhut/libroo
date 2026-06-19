import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useHead } from '#imports'

export function usePageTitle(title: MaybeRefOrGetter<string | null | undefined>) {
  useHead({
    title: computed(() => toValue(title) || undefined)
  })
}
