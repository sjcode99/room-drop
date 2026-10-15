export const CHUNK_SIZE = 16 * 1024

export type ControlMessage =
  | {
      type: 'file-offer'
      id: string
      name: string
      size: number
      mime: string
      preview?: string
    }
  | { type: 'file-accept'; id: string }
  | { type: 'file-decline'; id: string }
  | { type: 'file-done'; id: string }

export function cleanFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file'
  const cleaned = base.replace(/[?%*:|"<>]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180)
  return cleaned || 'file'
}

export function packChunk(fileId: string, data: ArrayBuffer): ArrayBuffer {
  const idBytes = new TextEncoder().encode(fileId)
  const payload = new Uint8Array(data)
  const out = new Uint8Array(1 + idBytes.length + payload.byteLength)
  out[0] = idBytes.length
  out.set(idBytes, 1)
  out.set(payload, 1 + idBytes.length)
  return out.buffer
}

export function unpackChunk(buffer: ArrayBuffer): { fileId: string; data: Uint8Array } | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 2) return null
  const idLength = bytes[0]
  if (idLength < 1 || bytes.length < 1 + idLength) return null
  const fileId = new TextDecoder().decode(bytes.subarray(1, 1 + idLength))
  return { fileId, data: bytes.subarray(1 + idLength) }
}

export function isControlMessage(value: unknown): value is ControlMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as { type?: unknown; id?: unknown; name?: unknown; size?: unknown; mime?: unknown; preview?: unknown }
  if (typeof message.id !== 'string' || message.id.length > 80) return false
  if (message.type === 'file-accept' || message.type === 'file-decline' || message.type === 'file-done') return true
  if (message.type !== 'file-offer') return false
  if (typeof message.name !== 'string' || message.name.length > 200) return false
  if (typeof message.mime !== 'string' || message.mime.length > 200) return false
  if (typeof message.size !== 'number' || !Number.isFinite(message.size) || message.size < 0) return false
  if (message.size > 8 * 1024 * 1024 * 1024) return false
  if (message.preview !== undefined && typeof message.preview !== 'string') return false
  return true
}

export function safePreview(preview: string | undefined): string | undefined {
  if (!preview) return undefined
  if (preview.length > 48_000) return undefined
  if (!preview.startsWith('data:image/jpeg;base64,') && !preview.startsWith('data:image/png;base64,')) return undefined
  return preview
}

function waitForDrain(channel: RTCDataChannel) {
  if (channel.readyState !== 'open') return Promise.reject(new Error('Connection closed'))
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      channel.onbufferedamountlow = null
      reject(new Error('Send stalled'))
    }, 20_000)
    channel.bufferedAmountLowThreshold = 256 * 1024
    channel.onbufferedamountlow = () => {
      window.clearTimeout(timer)
      channel.onbufferedamountlow = null
      resolve()
    }
  })
}

export async function sendFile(
  channel: RTCDataChannel,
  fileId: string,
  file: File,
  onProgress: (sent: number) => void,
) {
  let offset = 0
  while (offset < file.size) {
    if (channel.readyState !== 'open') throw new Error('Connection closed')
    if (channel.bufferedAmount > 1024 * 1024) await waitForDrain(channel)
    const end = Math.min(file.size, offset + CHUNK_SIZE)
    const buffer = await file.slice(offset, end).arrayBuffer()
    channel.send(packChunk(fileId, buffer))
    offset = end
    onProgress(offset)
  }
  if (channel.readyState !== 'open') throw new Error('Connection closed')
  const done: ControlMessage = { type: 'file-done', id: fileId }
  channel.send(JSON.stringify(done))
}

export function saveUrl(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = cleanFileName(filename)
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export async function makePreview(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/') || file.size > 30 * 1024 * 1024) return undefined
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return undefined
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const url = canvas.toDataURL('image/jpeg', 0.7)
    return safePreview(url)
  } catch {
    return undefined
  }
}

export function screenshotFile(file: File): File {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const extension = file.type === 'image/jpeg' ? 'jpg' : 'png'
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  return new File([file], `screenshot-${stamp}.${extension}`, { type })
}
