<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { BookDetails, BookLookupResult } from '~~/shared/types/book'
import { bookEditSchema, MANUAL_COVER_MAX_BYTES, type BookEditSchema } from '~~/shared/utils/schemas'
import { isValidIsbn } from '~~/shared/utils/isbn'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ book: BookDetails }>()
const emit = defineEmits<{ saved: [book: BookDetails] }>()
const toast = useToast()
const feedback = ref<{ title: string, description?: string, color: 'success' | 'warning' | 'error' } | null>(null)
const notify = (value: NonNullable<typeof feedback.value>) => {
  feedback.value = value
}
let savedToastId: string | number | undefined
const saving = ref(false)
const preparingCover = ref(false)
const findingCover = ref(false)
const findingDetails = ref(false)
const coverFile = ref<File | null>(null)
let version = 0
const state = reactive({
  expectedBookId: '', title: '', authors: [''], isbn: '', publisher: '', publishDate: '',
  numberOfPages: null as number | null, description: '',
  coverImage: null as BookEditSchema['coverImage'], removeCover: false
})
const pagesInput = computed<string | number>({
  get: () => state.numberOfPages ?? '',
  set: (value) => { state.numberOfPages = value === '' ? null : Number(value) }
})
const validIsbn = computed(() => isValidIsbn(state.isbn))
const preview = computed(() => state.coverImage
  ? `data:${state.coverImage.contentType};base64,${state.coverImage.data.replace(/^data:[^,]*,/, '')}`
  : !state.removeCover && props.book.coverPath ? `/api/blob/${props.book.coverPath}` : null)
const errorMessage = (error: unknown) => (error as { data?: { message?: string } })?.data?.message || (error instanceof Error ? error.message : 'Please try again.')
watch(open, (value) => {
  version++
  preparingCover.value = false
  if (!value) return
  feedback.value = null
  if (savedToastId !== undefined) {
    toast.remove(savedToastId)
    savedToastId = undefined
  }
  Object.assign(state, {
    expectedBookId: props.book.bookId, title: props.book.title,
    authors: props.book.authors.length ? props.book.authors.map(author => author.name) : [props.book.author || ''],
    isbn: props.book.isbn || '', publisher: props.book.publishers || '', publishDate: props.book.publishDate || '',
    numberOfPages: props.book.numberOfPages, description: props.book.description || '', coverImage: null, removeCover: false
  })
  coverFile.value = null
}, { immediate: true })

async function upload(file: File | null | undefined) {
  if (!file) return
  const current = ++version
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > MANUAL_COVER_MAX_BYTES) {
    coverFile.value = null
    notify({ title: 'Choose a JPEG, PNG, WebP or GIF up to 2 MB', color: 'error' })
    return
  }
  preparingCover.value = true
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1]!)
      reader.onerror = () => reject(new Error('Could not read this image'))
      reader.readAsDataURL(file)
    })
    if (current !== version || !open.value) return
    state.coverImage = { data, contentType: file.type, size: file.size }
    state.removeCover = false
  } catch (error) {
    notify({ title: 'Could not load image', description: errorMessage(error), color: 'error' })
  } finally {
    if (current === version) preparingCover.value = false
  }
}

function removeCover() {
  version++
  preparingCover.value = false
  state.coverImage = null
  state.removeCover = true
  coverFile.value = null
}
async function findCover() {
  if (!validIsbn.value || findingCover.value) return
  const current = ++version
  const isbn = state.isbn
  findingCover.value = true
  try {
    const image = await $fetch<NonNullable<BookEditSchema['coverImage']>>(`/api/books/${props.book.id}/cover-preview`, { method: 'POST', body: { isbn } })
    if (current !== version || !open.value || isbn !== state.isbn) return
    state.coverImage = image
    state.removeCover = false
    coverFile.value = null
    notify({ title: 'Cover found', description: 'Review it, then save your changes.', color: 'success' })
  } catch (error) {
    notify({ title: 'Cover not available', description: errorMessage(error), color: 'warning' })
  } finally { findingCover.value = false }
}
async function findDetails() {
  if (!validIsbn.value || findingDetails.value) return
  const isbn = state.isbn
  const current = version
  findingDetails.value = true
  try {
    const result = await $fetch<BookLookupResult>('/api/books/lookup', { method: 'POST', body: { isbn } })
    if (current !== version || !open.value || isbn !== state.isbn) return
    if (!result.found) {
      notify({ title: 'No matching details found', color: 'warning' })
      return
    }
    if (!state.title.trim()) state.title = result.title || ''
    if (!state.authors.some(author => author.trim())) state.authors = result.authors?.length ? result.authors : [result.author || '']
    if (!state.publisher.trim()) state.publisher = result.publishers?.join(', ') || ''
    if (!state.publishDate.trim()) state.publishDate = result.publishDate || ''
    if (!state.numberOfPages) state.numberOfPages = result.numberOfPages || null
    if (!state.description.trim()) state.description = result.description || ''
    notify({ title: 'Lookup complete', description: 'Available details filled empty fields. Existing values were kept.', color: 'success' })
  } catch (error) {
    notify({ title: 'Could not find details', description: errorMessage(error), color: 'error' })
  } finally { findingDetails.value = false }
}
async function save(event: FormSubmitEvent<BookEditSchema>) {
  saving.value = true
  try {
    const book = await $fetch<BookDetails>(`/api/books/${props.book.id}`, { method: 'PUT', body: event.data })
    emit('saved', book)
    open.value = false
    savedToastId = toast.add({ title: 'Book updated', color: 'success' }).id
  } catch (error) {
    notify({ title: 'Could not save book', description: errorMessage(error), color: 'error' })
  } finally { saving.value = false }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Edit book"
    description="Changes apply to this entry in your library."
    :dismissible="!saving"
    :close="!saving"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <UForm
        id="book-edit-form"
        :schema="bookEditSchema"
        :state="state"
        class="space-y-6"
        @submit="save"
      >
        <fieldset
          :disabled="saving"
          class="space-y-6"
        >
          <UFormField
            label="Title"
            name="title"
            required
          >
            <UInput
              v-model="state.title"
              class="w-full"
              autofocus
            />
          </UFormField>
          <UFormField
            label="Authors"
            name="authors"
            required
            description="One name per row, in the order you want displayed."
          >
            <div class="space-y-2">
              <div
                v-for="(_, index) in state.authors"
                :key="index"
                class="flex gap-2"
              >
                <UInput
                  v-model="state.authors[index]"
                  :aria-label="`Author ${index + 1}`"
                  class="min-w-0 flex-1"
                />
                <UButton
                  icon="i-lucide-x"
                  variant="ghost"
                  color="neutral"
                  :aria-label="`Remove author ${index + 1}`"
                  :disabled="state.authors.length === 1"
                  @click="state.authors.splice(index, 1)"
                />
              </div>
              <UButton
                label="Add author"
                icon="i-lucide-plus"
                variant="link"
                size="sm"
                :disabled="state.authors.length >= 20"
                @click="state.authors.push('')"
              />
            </div>
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="ISBN"
              name="isbn"
              hint="Optional"
            >
              <UInput
                v-model="state.isbn"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Publisher"
              name="publisher"
            >
              <UInput
                v-model="state.publisher"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Publication date"
              name="publishDate"
              hint="Year or date"
            >
              <UInput
                v-model="state.publishDate"
                placeholder="e.g. 2015"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Pages"
              name="numberOfPages"
            >
              <UInput
                v-model.number="pagesInput"
                type="number"
                :min="1"
                :max="100000"
                class="w-full"
              />
            </UFormField>
          </div>
          <UButton
            label="Find missing details by ISBN"
            icon="i-lucide-search"
            variant="soft"
            :disabled="!validIsbn || findingDetails"
            :loading="findingDetails"
            @click="findDetails"
          />
          <UFormField
            label="Description"
            name="description"
          >
            <UTextarea
              v-model="state.description"
              :rows="4"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Cover"
            name="coverImage"
            description="Upload an image up to 2 MB, or find a cover through Open Library. Preview changes before saving."
          >
            <div class="mt-2 flex flex-col gap-4 sm:flex-row">
              <div class="flex aspect-2/3 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-default bg-muted">
                <NuxtImg
                  v-if="preview"
                  :src="preview"
                  alt="Cover preview"
                  class="size-full object-contain"
                />
                <UIcon
                  v-else
                  name="i-lucide-book-image"
                  class="size-8 text-dimmed"
                />
              </div>
              <div class="min-w-0 flex-1 space-y-3">
                <UFileUpload
                  v-model="coverFile"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  label="Upload cover"
                  description="JPEG, PNG, WebP or GIF · up to 2 MB"
                  class="min-h-24"
                  @update:model-value="upload"
                />
                <div class="flex flex-wrap gap-2">
                  <UButton
                    label="Find cover by ISBN"
                    icon="i-lucide-search"
                    variant="soft"
                    :disabled="!validIsbn || findingCover || preparingCover"
                    :loading="findingCover"
                    @click="findCover"
                  />
                  <UButton
                    label="Remove cover"
                    icon="i-lucide-image-off"
                    variant="ghost"
                    color="neutral"
                    :disabled="!preview"
                    @click="removeCover"
                  />
                </div>
              </div>
            </div>
          </UFormField>
        </fieldset>
      </UForm>
    </template>
    <template #footer>
      <div class="w-full space-y-3">
        <UAlert
          v-if="feedback"
          :title="feedback.title"
          :description="feedback.description"
          :color="feedback.color"
          variant="soft"
        />
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="open = false"
          />
          <UButton
            label="Save changes"
            form="book-edit-form"
            type="submit"
            :loading="saving"
            :disabled="findingCover || findingDetails || preparingCover"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
