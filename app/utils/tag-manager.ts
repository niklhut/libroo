export interface TagLike {
  id: string
  name: string
}

export function getAvailableSuggestedTags<T extends TagLike>(allSuggestedTags: T[], workingUserTags: TagLike[]): T[] {
  const selectedIds = new Set(workingUserTags.map(tag => tag.id))
  return allSuggestedTags.filter(tag => !selectedIds.has(tag.id))
}
