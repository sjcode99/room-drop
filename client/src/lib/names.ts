const ADJECTIVES = ['Blue', 'Calm', 'Bright', 'Quiet', 'Swift', 'Amber', 'Copper', 'Gentle', 'Misty', 'Warm']
const NOUNS = ['Otter', 'Robin', 'Maple', 'Harbor', 'Pebble', 'Cedar', 'Lark', 'Willow', 'Fern', 'Brook']

const NAME_KEY = 'roomdrop-name'
const ID_KEY = 'roomdrop-peer-id'

export function getPeerId(): string {
  const existing = sessionStorage.getItem(ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  sessionStorage.setItem(ID_KEY, id)
  return id
}

export function randomName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adjective} ${noun}`
}

export function getDisplayName(): string {
  const existing = sessionStorage.getItem(NAME_KEY)
  if (existing) return existing
  const name = randomName()
  sessionStorage.setItem(NAME_KEY, name)
  return name
}

export function setDisplayName(name: string) {
  sessionStorage.setItem(NAME_KEY, name)
}
