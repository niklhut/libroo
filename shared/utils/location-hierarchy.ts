import type { BookLocation, BookLocationWithCount } from '../types/book'

export interface LocationHierarchyRecord {
  id: string
  name: string
  parentLocationId: string | null
  path: string
  depth: number
}

export interface LocationCountRecord extends LocationHierarchyRecord {
  directBookCount: number
}

export interface LocationRepathUpdate {
  id: string
  path: string
  depth: number
}

export const locationChildPath = (parent: LocationHierarchyRecord | null, name: string) =>
  parent ? `${parent.path} - ${name}` : name

export const escapeLocationLikePattern = (value: string) =>
  value.replace(/[\\%_]/g, match => `\\${match}`)

export const locationDescendantPathLike = (location: LocationHierarchyRecord) =>
  `${escapeLocationLikePattern(location.path)} - %`

export const isLocationDescendant = (location: LocationHierarchyRecord, possibleAncestor: LocationHierarchyRecord) =>
  location.id !== possibleAncestor.id && location.path.startsWith(`${possibleAncestor.path} - `)

export const calculateLocationCounts = (locations: LocationCountRecord[]) => {
  const directCounts = new Map(locations.map(location => [location.id, location.directBookCount]))

  return locations.map((location) => {
    const descendantBookCount = locations.reduce((total, candidate) => {
      return isLocationDescendant(candidate, location)
        ? total + (directCounts.get(candidate.id) ?? 0)
        : total
    }, 0)

    return {
      ...location,
      bookCount: location.directBookCount,
      descendantBookCount
    }
  })
}

export const insertLocationLocally = (
  currentLocations: BookLocationWithCount[] | null | undefined,
  location: BookLocation
) => calculateLocationCounts([
  ...(currentLocations ?? []),
  {
    ...location,
    bookCount: 0,
    directBookCount: 0,
    descendantBookCount: 0
  }
])

export function computeLocationRepath(
  location: LocationHierarchyRecord,
  descendants: LocationHierarchyRecord[],
  parent: LocationHierarchyRecord | null,
  name = location.name
) {
  const nextPath = locationChildPath(parent, name)
  const nextDepth = parent ? parent.depth + 1 : 0
  const oldPathPrefix = `${location.path} - `
  const newPathPrefix = `${nextPath} - `
  const depthDelta = nextDepth - location.depth

  return {
    location: {
      ...location,
      name,
      parentLocationId: parent?.id ?? null,
      path: nextPath,
      depth: nextDepth
    },
    descendants: descendants.map((descendant): LocationRepathUpdate => ({
      id: descendant.id,
      path: descendant.path.replace(oldPathPrefix, newPathPrefix),
      depth: descendant.depth + depthDelta
    }))
  }
}
