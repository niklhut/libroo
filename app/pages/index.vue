<template>
  <div class="min-h-[60vh]">
    <UPageHero
      title="Your Library, Managed"
      description="A private, physical-first library management system designed to turn piles of books into a curated, organized, and trackable collection."
      :links="[{
        label: 'Get Started',
        to: '/auth/register',
        trailingIcon: 'i-lucide-arrow-right',
        size: 'xl'
      }, {
        label: 'Sign In',
        to: '/auth/login',
        size: 'xl',
        color: 'neutral',
        variant: 'subtle'
      }]"
    />

    <UPageSection
      id="features"
      title="Everything you need to manage your physical library"
      description="Libroo bridges the gap between digital discovery and physical ownership, giving book lovers total clarity over what they own."
      :features="[{
        icon: 'i-lucide-book-copy',
        title: 'Physical Inventory First',
        description: 'Track what you actually own. No more accidental duplicates or forgotten treasures on your shelves.'
      }, {
        icon: 'i-lucide-users',
        title: 'Lending Ledger',
        description: 'Know exactly which friend has your book, when they took it, and how long they\'ve had it.'
      }, {
        icon: 'i-lucide-map-pin',
        title: 'Shelf Mapping',
        description: 'Assign books to specific locations like Living Room Shelf B or Storage Box 4.'
      }, {
        icon: 'i-lucide-scan-barcode',
        title: 'Fast Cataloging',
        description: 'Use barcode scanning to catalog books in minutes with high-quality metadata.'
      }, {
        icon: 'i-lucide-lock',
        title: 'Privacy-First',
        description: 'Your collection is your business. Your library data belongs to you.'
      }, {
        icon: 'i-lucide-sparkles',
        title: 'Beautiful Interface',
        description: 'A clean interface that celebrates cover art while remaining a powerful utility tool.'
      }]"
    />

    <UPageSection>
      <UPageCTA
        title="Ready to organize your library?"
        description="Join book lovers who want total clarity over their collection. Start cataloging today."
        variant="subtle"
        :links="[{
          label: 'Create Free Account',
          to: '/auth/register',
          trailingIcon: 'i-lucide-arrow-right',
          color: 'neutral'
        }]"
      />
    </UPageSection>
  </div>
</template>
