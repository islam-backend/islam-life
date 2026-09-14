/** Convert any file to a base64 data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('read-error'))
    reader.readAsDataURL(file)
  })
}

/** Read a text file as a UTF-8 string. */
export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('read-error'))
    reader.readAsText(file, 'utf-8')
  })
}

const TEXT_EXTS = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.ts'])

export function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  const dot = file.name.lastIndexOf('.')
  if (dot === -1) return false
  return TEXT_EXTS.has(file.name.slice(dot).toLowerCase())
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
