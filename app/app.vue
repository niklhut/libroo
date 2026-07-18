<script setup lang="ts">
import { useHead, useRequestURL, useSeoMeta } from '#imports'
import { appName, formatPageTitle } from '~/utils/page-title'

const appDescription = 'Private library management for inventory, lending, and shelf mapping.'
const requestUrl = useRequestURL()
const socialImage = new URL('/libroo-social-card.png', requestUrl.origin).href

useHead({
  titleTemplate: (title?: string) => formatPageTitle(title),
  htmlAttrs: {
    lang: 'en'
  },
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', type: 'image/png', sizes: '96x96', href: '/favicon-96x96.png' },
    { rel: 'shortcut icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
    { rel: 'manifest', href: '/site.webmanifest' }
  ],
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'application-name', content: appName },
    { name: 'apple-mobile-web-app-title', content: appName },
    { name: 'theme-color', content: '#ffffff' }
  ]
})

useSeoMeta({
  description: appDescription,
  ogTitle: appName,
  ogDescription: appDescription,
  ogSiteName: appName,
  ogType: 'website',
  ogImage: socialImage,
  twitterCard: 'summary_large_image',
  twitterTitle: appName,
  twitterDescription: appDescription,
  twitterImage: socialImage
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
