import { describe, it, expect } from 'vitest'
import { getAvailableSuggestedTags } from '../../app/utils/tag-manager'

describe('tag manager helpers', () => {
  it('excludes tags that are currently selected by the user', () => {
    const allSuggested = [
      { id: '1', name: 'Thrillers' },
      { id: '2', name: 'Suspense' },
      { id: '3', name: 'Mystery' }
    ]

    const workingUser = [
      { id: '2', name: 'Suspense' }
    ]

    expect(getAvailableSuggestedTags(allSuggested, workingUser)).toEqual([
      { id: '1', name: 'Thrillers' },
      { id: '3', name: 'Mystery' }
    ])
  })

  it('returns a previously selected suggested tag after removal', () => {
    const allSuggested = [
      { id: '1', name: 'Thrillers' },
      { id: '2', name: 'Suspense' }
    ]

    const beforeRemoval = [{ id: '1', name: 'Thrillers' }]
    const afterRemoval: Array<{ id: string, name: string }> = []

    expect(getAvailableSuggestedTags(allSuggested, beforeRemoval)).toEqual([
      { id: '2', name: 'Suspense' }
    ])

    expect(getAvailableSuggestedTags(allSuggested, afterRemoval)).toEqual([
      { id: '1', name: 'Thrillers' },
      { id: '2', name: 'Suspense' }
    ])
  })
})
