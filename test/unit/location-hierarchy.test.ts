import { describe, expect, it } from 'vitest'
import { calculateLocationCounts, computeLocationRepath, locationDescendantPathLike } from '../../shared/utils/location-hierarchy'

describe('location hierarchy helpers', () => {
  it('calculates direct and descendant book counts for arbitrary depth', () => {
    expect(calculateLocationCounts([
      { id: 'room', name: 'Room', parentLocationId: null, path: 'Room', depth: 0, directBookCount: 1 },
      { id: 'shelf', name: 'Shelf', parentLocationId: 'room', path: 'Room - Shelf', depth: 1, directBookCount: 2 },
      { id: 'box', name: 'Box', parentLocationId: 'shelf', path: 'Room - Shelf - Box', depth: 2, directBookCount: 3 },
      { id: 'desk', name: 'Desk', parentLocationId: null, path: 'Desk', depth: 0, directBookCount: 4 }
    ])).toEqual([
      {
        id: 'room',
        name: 'Room',
        parentLocationId: null,
        path: 'Room',
        depth: 0,
        directBookCount: 1,
        bookCount: 1,
        descendantBookCount: 5
      },
      {
        id: 'shelf',
        name: 'Shelf',
        parentLocationId: 'room',
        path: 'Room - Shelf',
        depth: 1,
        directBookCount: 2,
        bookCount: 2,
        descendantBookCount: 3
      },
      {
        id: 'box',
        name: 'Box',
        parentLocationId: 'shelf',
        path: 'Room - Shelf - Box',
        depth: 2,
        directBookCount: 3,
        bookCount: 3,
        descendantBookCount: 0
      },
      {
        id: 'desk',
        name: 'Desk',
        parentLocationId: null,
        path: 'Desk',
        depth: 0,
        directBookCount: 4,
        bookCount: 4,
        descendantBookCount: 0
      }
    ])
  })

  it('recomputes descendant paths when renaming a location', () => {
    const result = computeLocationRepath(
      { id: 'shelf', name: 'Shelf', parentLocationId: 'room', path: 'Room - Shelf', depth: 1 },
      [
        { id: 'box', name: 'Box', parentLocationId: 'shelf', path: 'Room - Shelf - Box', depth: 2 },
        { id: 'slot', name: 'Slot', parentLocationId: 'box', path: 'Room - Shelf - Box - Slot', depth: 3 }
      ],
      { id: 'room', name: 'Room', parentLocationId: null, path: 'Room', depth: 0 },
      'Shelf B'
    )

    expect(result.location).toMatchObject({
      id: 'shelf',
      name: 'Shelf B',
      parentLocationId: 'room',
      path: 'Room - Shelf B',
      depth: 1
    })
    expect(result.descendants).toEqual([
      { id: 'box', path: 'Room - Shelf B - Box', depth: 2 },
      { id: 'slot', path: 'Room - Shelf B - Box - Slot', depth: 3 }
    ])
  })

  it('recomputes descendant paths and depths when moving a location', () => {
    const result = computeLocationRepath(
      { id: 'shelf', name: 'Shelf', parentLocationId: 'room', path: 'Room - Shelf', depth: 1 },
      [
        { id: 'box', name: 'Box', parentLocationId: 'shelf', path: 'Room - Shelf - Box', depth: 2 }
      ],
      { id: 'storage', name: 'Storage', parentLocationId: null, path: 'Storage', depth: 0 }
    )

    expect(result.location).toMatchObject({
      id: 'shelf',
      parentLocationId: 'storage',
      path: 'Storage - Shelf',
      depth: 1
    })
    expect(result.descendants).toEqual([
      { id: 'box', path: 'Storage - Shelf - Box', depth: 2 }
    ])
  })

  it('escapes SQL LIKE wildcards in descendant path patterns', () => {
    expect(locationDescendantPathLike({
      id: 'loc-1',
      name: 'A_%',
      parentLocationId: null,
      path: String.raw`A_\%`,
      depth: 0
    })).toBe(String.raw`A\_\\\% - %`)
  })
})
