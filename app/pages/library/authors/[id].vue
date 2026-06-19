<script setup lang="ts">
import type { AuthorLibrary } from '~~/shared/types/book'

const route = useRoute()
const authorId = route.params.id as string

const page = ref(1)
const pageSize = 12
const allBooks = ref<AuthorLibrary['items']>([])
const pagination = ref<AuthorLibrary['pagination'] | null>(null)
const isLoadingMore = ref(false)

const { data, refresh, status } = await useFetch<AuthorLibrary>(`/api/authors/${authorId}/books`, {
  headers: useRequestHeaders(['cookie']),
  watch: false,
  query: computed(() => ({
    page: page.value,
    pageSize
  }))
})

watch(data, (response) => {
  if (!response) return

  pagination.value = response.pagination

  if (page.value === 1) {
    allBooks.value = [...response.items]
  } else {
    const existingIds = new Set(allBooks.value.map(book => book.id))
    const newItems = response.items.filter(book => !existingIds.has(book.id))
    allBooks.value.push(...newItems)
  }
}, { immediate: true })

const author = computed(() => data.value?.author)
const hasBooks = computed(() => allBooks.value.length > 0)

usePageTitle(computed(() => author.value?.name ?? 'Author'))

async function loadMore() {
  if (pagination.value?.hasMore && !isLoadingMore.value) {
    isLoadingMore.value = true
    try {
      page.value++
      await refresh()
    } catch (error) {
      page.value--
      throw error
    } finally {
      isLoadingMore.value = false
    }
  }
}
</script>

<template>
  <UContainer>
    <UPageHeader
      :title="author?.name || 'Author'"
      :description="pagination ? `${pagination.totalItems} ${pagination.totalItems === 1 ? 'book' : 'books'} in your library` : undefined"
    >
      <template #links>
        <UButton
          to="/library"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
        >
          Library
        </UButton>
      </template>
    </UPageHeader>

    <UPageBody>
      <div
        v-if="status === 'pending' && !hasBooks"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <UCard
        v-else-if="!hasBooks"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-book-open"
          class="text-6xl text-muted mx-auto mb-4"
        />
        <h2 class="text-xl font-semibold mb-2">
          No books found
        </h2>
        <p class="text-muted mb-6">
          There are no books by this author in your library.
        </p>
        <UButton to="/library">
          Back to Library
        </UButton>
      </UCard>

      <template v-else>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <BookCard
            v-for="book in allBooks"
            :id="book.id"
            :key="book.id"
            :book-id="book.bookId"
            :title="book.title"
            :author="book.author"
            :isbn="book.isbn"
            :cover-path="book.coverPath"
            :added-at="book.addedAt"
          />
        </div>

        <div
          v-if="pagination?.hasMore"
          class="mt-8 text-center"
        >
          <UButton
            color="neutral"
            variant="outline"
            :loading="isLoadingMore"
            :disabled="isLoadingMore"
            @click="loadMore"
          >
            Load More
          </UButton>
        </div>
      </template>
    </UPageBody>
  </UContainer>
</template>
