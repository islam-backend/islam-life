// Resize + compress an image entirely in the browser and return a data: URL.
// We store chat images straight in the Firestore comment doc (no Firebase
// Storage bucket needed), so the result MUST stay well under Firestore's
// 1 MiB document limit.

/** Chat attachment — up to ~1280px, kept under ~900KB. */
export function fileToChatImage(file: File): Promise<string> {
  return resizeToDataUrl(file, 1280, 900_000)
}

/** Client / avatar image — small square-ish, kept tiny since it rides on
 * the client doc and is drawn at ~24px. */
export function fileToAvatarImage(file: File): Promise<string> {
  return resizeToDataUrl(file, 256, 120_000)
}

async function resizeToDataUrl(file: File, maxDim: number, maxBytes: number): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('not-an-image')

  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  if ('close' in bitmap) (bitmap as ImageBitmap).close()

  // PNG compresses badly — always emit JPEG, stepping quality down to fit.
  for (const q of [0.8, 0.68, 0.55, 0.42, 0.3, 0.2]) {
    const url = canvas.toDataURL('image/jpeg', q)
    if (url.length <= maxBytes) return url
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
