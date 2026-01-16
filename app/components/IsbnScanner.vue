<script setup lang="ts">
import { QrcodeStream } from 'vue-qrcode-reader'

const props = defineProps<{
  continuous?: boolean
}>()

const emit = defineEmits<{
  detected: [isbn: string]
  error: [message: string]
}>()

const isLoading = ref(true)
const errorMessage = ref<string | null>(null)
const lastScanned = ref<string | null>(null)
const scanCooldown = ref(false)
const isFrontCamera = ref(false)

// Track bounding box for visual feedback
const detectedBarcodes = ref<Array<{ boundingBox: DOMRectReadOnly }>>([])

// Camera constraints - prefer rear camera
const constraints: MediaTrackConstraints = {
  facingMode: 'environment'
}

// Barcode formats for ISBN (EAN-13, EAN-8, UPC-A)
const formats = ['ean_13', 'ean_8', 'upc_a'] as ('ean_13' | 'ean_8' | 'upc_a')[]

function onCameraReady(capabilities: Partial<MediaTrackCapabilities>) {
  isLoading.value = false
  errorMessage.value = null

  // Detect if this is a front-facing (selfie) camera
  const facingModes = capabilities?.facingMode
  isFrontCamera.value = Array.isArray(facingModes) && facingModes.includes('user')
}

function onError(error: Error) {
  isLoading.value = false

  if (error.name === 'NotAllowedError') {
    errorMessage.value = 'Camera permission was denied. Please allow camera access to scan barcodes.'
  } else if (error.name === 'NotFoundError') {
    errorMessage.value = 'No camera found on this device.'
  } else if (error.name === 'NotReadableError') {
    errorMessage.value = 'Camera is already in use by another application.'
  } else if (error.name === 'OverconstrainedError') {
    errorMessage.value = 'Could not find a suitable camera. Try using a different device.'
  } else {
    errorMessage.value = `Camera error: ${error.message}`
  }

  emit('error', errorMessage.value)
}

function onDetect(detectedCodes: Array<{ rawValue: string, format: string, boundingBox: DOMRectReadOnly }>) {
  if (detectedCodes.length === 0) {
    detectedBarcodes.value = []
    return
  }

  // Store bounding boxes for visual feedback
  detectedBarcodes.value = detectedCodes.map(code => ({ boundingBox: code.boundingBox }))

  // Get the first detected barcode
  const code = detectedCodes[0]
  if (!code) return

  const isbn = code.rawValue

  // Prevent duplicate scans within cooldown period
  if (scanCooldown.value && isbn === lastScanned.value) {
    return
  }

  lastScanned.value = isbn
  emit('detected', isbn)

  // In continuous mode, add a cooldown to prevent immediate re-detection
  if (props.continuous) {
    scanCooldown.value = true
    setTimeout(() => {
      scanCooldown.value = false
    }, 2000)
    // Auto-hide the last scanned indicator after 3 seconds
    setTimeout(() => {
      if (lastScanned.value === isbn) {
        lastScanned.value = null
      }
    }, 3000)
  }
}
</script>

<template>
  <div class="isbn-scanner relative">
    <!-- Loading state -->
    <div
      v-if="isLoading"
      class="absolute inset-0 flex items-center justify-center bg-neutral-900 rounded-lg z-10"
    >
      <div class="text-center">
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-3xl text-primary mb-2"
        />
        <p class="text-sm text-neutral-400">
          Starting camera...
        </p>
      </div>
    </div>

    <!-- Error state -->
    <div
      v-if="errorMessage"
      class="absolute inset-0 flex items-center justify-center bg-neutral-900 rounded-lg z-10 p-4"
    >
      <div class="text-center">
        <UIcon
          name="i-lucide-camera-off"
          class="text-4xl text-error mb-3"
        />
        <p class="text-sm text-neutral-300">
          {{ errorMessage }}
        </p>
      </div>
    </div>

    <!-- Camera stream -->
    <QrcodeStream
      :constraints="constraints"
      :formats="formats"
      class="rounded-lg overflow-hidden aspect-[4/3]"
      :class="{ 'scanner-mirrored': isFrontCamera }"
      @camera-on="onCameraReady"
      @error="onError"
      @detect="onDetect"
    >
      <!-- Scanning overlay with darkened edges -->
      <div class="absolute inset-0 pointer-events-none">
        <!-- Semi-transparent overlay (darkens edges) -->
        <div class="absolute inset-0 bg-black/40" />

        <!-- Clear center area for scanning - this gets "cut out" -->
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="scan-window relative w-[70%] h-[40%] bg-transparent rounded-lg overflow-hidden">
            <!-- Clear background to show camera through -->
            <div
              class="absolute inset-0 backdrop-blur-0"
              style="background: transparent; box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);"
            />

            <!-- Corner brackets -->
            <div class="absolute inset-0">
              <div class="absolute top-0 left-0 w-6 h-6 border-t-3 border-l-3 border-primary rounded-tl-lg" />
              <div class="absolute top-0 right-0 w-6 h-6 border-t-3 border-r-3 border-primary rounded-tr-lg" />
              <div class="absolute bottom-0 left-0 w-6 h-6 border-b-3 border-l-3 border-primary rounded-bl-lg" />
              <div class="absolute bottom-0 right-0 w-6 h-6 border-b-3 border-r-3 border-primary rounded-br-lg" />
            </div>

            <!-- Scanning line animation -->
            <div class="absolute inset-x-2 top-1/2 -translate-y-1/2">
              <div class="h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />
            </div>
          </div>
        </div>

        <!-- Instruction text at top -->
        <div class="absolute top-4 left-0 right-0 text-center">
          <span class="bg-black/60 text-white text-xs px-3 py-1 rounded-full">
            Align barcode in the center
          </span>
        </div>

        <!-- Last scanned indicator with fade animation -->
        <Transition name="fade">
          <div
            v-if="lastScanned && continuous"
            class="absolute bottom-4 left-1/2 -translate-x-1/2"
          >
            <UBadge
              color="success"
              variant="solid"
              size="lg"
            >
              <UIcon
                name="i-lucide-check"
                class="mr-1"
              />
              {{ lastScanned }}
            </UBadge>
          </div>
        </Transition>
      </div>
    </QrcodeStream>

    <!-- Instructions -->
    <p class="text-center text-sm text-muted mt-3">
      <template v-if="continuous">
        Point camera at book barcodes to scan continuously
      </template>
      <template v-else>
        Point camera at a book barcode to scan
      </template>
    </p>
  </div>
</template>

<style scoped>
.isbn-scanner :deep(video) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Mirror the video for selfie camera */
.scanner-mirrored :deep(video) {
  transform: scaleX(-1);
}

.border-3 {
  border-width: 3px;
}

/* Fade transition for ISBN badge */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
