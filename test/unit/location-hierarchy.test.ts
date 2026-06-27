import { describe, expect, it } from 'vitest'
import {
  calculateLocationCounts,
  computeLocationRepath,
  insertLocationLocally,
  locationDescendantPathLike
} from '../../shared/utils/location-hierarchy'

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

  it('inserts a top-level location with its server path available as the selector label', () => {
    const locations = insertLocationLocally(null, {
      id: 'loc-room',
      name: 'Reading Room',
      parentLocationId: null,
      path: 'Reading Room',
      depth: 0
    })

    expect(locations).toEqual([
      {
        id: 'loc-room',
        name: 'Reading Room',
        parentLocationId: null,
        path: 'Reading Room',
        depth: 0,
        bookCount: 0,
        directBookCount: 0,
        descendantBookCount: 0
      }
    ])
    expect(locations.map(location => ({ label: location.path, value: location.id }))).toContainEqual({
      label: 'Reading Room',
      value: 'loc-room'
    })
  })

  it('inserts a nested location using the server-returned dash-separated path', () => {
    const locations = insertLocationLocally([
      {
        id: 'loc-room',
        name: 'Reading Room',
        parentLocationId: null,
        path: 'Reading Room',
        depth: 0,
        bookCount: 2,
        directBookCount: 2,
        descendantBookCount: 0
      }
    ], {
      id: 'loc-shelf',
      name: 'Shelf A',
      parentLocationId: 'loc-room',
      path: 'Reading Room - Shelf A',
      depth: 1
    })

    const options = locations.map(location => ({ label: location.path, value: location.id }))

    expect(locations.find(location => location.id === 'loc-shelf')).toMatchObject({
      id: 'loc-shelf',
      path: 'Reading Room - Shelf A',
      bookCount: 0,
      directBookCount: 0,
      descendantBookCount: 0
    })
    expect(options.find(option => option.value === 'loc-shelf')?.label).toBe('Reading Room - Shelf A')
  })

  it('recalculates counts after inserting a location', () => {
    const locations = insertLocationLocally([
      {
        id: 'loc-room',
        name: 'Reading Room',
        parentLocationId: null,
        path: 'Reading Room',
        depth: 0,
        bookCount: 1,
        directBookCount: 1,
        descendantBookCount: 0
      },
      {
        id: 'loc-shelf',
        name: 'Shelf A',
        parentLocationId: 'loc-room',
        path: 'Reading Room - Shelf A',
        depth: 1,
        bookCount: 3,
        directBookCount: 3,
        descendantBookCount: 0
      }
    ], {
      id: 'loc-box',
      name: 'Box 1',
      parentLocationId: 'loc-shelf',
      path: 'Reading Room - Shelf A - Box 1',
      depth: 2
    })

    expect(locations).toMatchObject([
      {
        id: 'loc-room',
        bookCount: 1,
        directBookCount: 1,
        descendantBookCount: 3
      },
      {
        id: 'loc-shelf',
        bookCount: 3,
        directBookCount: 3,
        descendantBookCount: 0
      },
      {
        id: 'loc-box',
        bookCount: 0,
        directBookCount: 0,
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
