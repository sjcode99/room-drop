export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '0 B'
  if (size < 1024) return `${Math.round(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function kindLabel(name: string, mime: string): string {
  const lower = name.toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return 'Image'
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'PDF'
  if (mime.includes('word') || /\.docx?$/.test(lower)) return 'Document'
  if (mime.startsWith('text/') || /\.(txt|md|csv|json)$/.test(lower)) return 'Text'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.startsWith('audio/')) return 'Audio'
  if (/\.(zip|rar|7z)$/.test(lower)) return 'Archive'
  return 'File'
}

export function percent(done: number, total: number): number {
  if (total <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}
