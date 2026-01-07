<script setup lang="ts">
// Default layout with header
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <AppHeader />

    <main class="flex-1">
      <slot />
    </main>
  </div>
</template>
