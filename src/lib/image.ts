// Resize + compress an image entirely in the browser and return a data: URL.
// We store chat images straight in the Firestore comment doc (no Firebase
// Storage bucket needed), so the result MUST stay well under Firestore's
// 1 MiB document limit.

const MAX_DIM = 1280
const MAX_BYTES = 900_000 // data-URL length ceiling, leaves room for other fields

export async function fileToChatImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('not-an-image')

  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  if ('close' in bitmap) (bitmap as ImageBitmap).close()

  // PNG screenshots compress badly as PNG — always go out as JPEG, stepping
  // quality down until it fits.
  for (const q of [0.72, 0.6, 0.48, 0.36, 0.25]) {
    const url = canvas.toDataURL('image/jpeg', q)
    if (url.length <= MAX_BYTES) return url
  }
  throw new Error('too-large')
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file)
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
