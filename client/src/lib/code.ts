export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/

export function createRoomCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

export function isRoomCode(input: string): boolean {
  return CODE_RE.test(input)
}

export function extractCode(input: string): string {
  const match = input.toUpperCase().match(/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}/)
  return match?.[0] ?? ''
}
