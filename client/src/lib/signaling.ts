import type { SignalData } from './peer'

export type ServerMessage =
  | { type: 'joined'; peers: { id: string; name: string }[] }
  | { type: 'peer-joined'; peer: { id: string; name: string } }
  | { type: 'peer-left'; peerId: string }
  | { type: 'peer-renamed'; peerId: string; name: string }
  | { type: 'signal'; from: string; data: SignalData }
  | { type: 'error'; message: string }

export type ClientMessage =
  | { type: 'join'; room: string; peerId: string; name: string }
  | { type: 'signal'; to: string; data: SignalData }
  | { type: 'rename'; name: string }

export function openSignaling(handlers: {
  onMessage: (message: ServerMessage) => void
  onStatus: (status: 'open' | 'closed') => void
}) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(`${proto}//${location.host}/ws`)
  const queue: ClientMessage[] = []
  let open = false
  let closed = false

  socket.onopen = () => {
    open = true
    handlers.onStatus('open')
    for (const message of queue) socket.send(JSON.stringify(message))
    queue.length = 0
  }
  socket.onclose = () => {
    open = false
    if (!closed) handlers.onStatus('closed')
  }
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    try {
      handlers.onMessage(JSON.parse(event.data) as ServerMessage)
    } catch {
      // Ignore malformed signaling frames.
    }
  }

  return {
    send(message: ClientMessage) {
      if (closed) return
      if (open && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
      else queue.push(message)
    },
    close() {
      closed = true
      queue.length = 0
      socket.close()
    },
  }
}
