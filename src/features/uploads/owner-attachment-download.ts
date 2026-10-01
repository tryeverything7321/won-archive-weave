export type OwnerDownloadState = 'idle' | 'working' | 'error'

export async function runOwnerAttachmentDownload(
  load: () => Promise<{ url: string }>,
  navigate: (url: string) => void,
  setState: (state: OwnerDownloadState) => void,
): Promise<void> {
  setState('working')
  try {
    const link = await load()
    navigate(link.url)
    setState('idle')
  } catch {
    setState('error')
  }
}
