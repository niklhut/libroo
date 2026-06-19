export const appName = 'Libroo'

export function formatPageTitle(title?: string | null) {
  return title ? `${title} · ${appName}` : appName
}
