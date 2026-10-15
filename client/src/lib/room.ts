import { setDisplayName } from './names'
import { createPeerLink, type PeerLink, type SignalData } from './peer'
import { openSignaling, type ServerMessage } from './signaling'
import {
  cleanFileName,
  isControlMessage,
  makePreview,
  safePreview,
  saveUrl,
  sendFile,
  unpackChunk,
  type ControlMessage,
} from './transfer'

export type PeerState = 'connecting' | 'connected' | 'failed' | 'closed'

export type PeerInfo = {
  id: string
  name: string
  state: PeerState
}

export type IncomingFile = {
  id: string
  fromId: string
  name: string
  size: number
  mime: string
  preview?: string
  received: number
  status: 'offered' | 'receiving' | 'done' | 'declined' | 'error'
  error?: string
  downloadUrl?: string
}

export type OutgoingTarget = {
  peerId: string
  sent: number
  status: 'waiting' | 'sending' | 'done' | 'declined' | 'error'
  error?: string
}

export type OutgoingFile = {
  id: string
  name: string
  size: number
  mime: string
  targets: OutgoingTarget[]
}

export type RoomSnapshot = {
  socketStatus: 'connecting' | 'open' | 'closed'
  notice: string
  selfName: string
  peers: PeerInfo[]
  incoming: IncomingFile[]
  outgoing: OutgoingFile[]
}

type IncomingInternal = IncomingFile & { parts: ArrayBuffer[] }
type OutgoingInternal = OutgoingFile & { file: File }
type PeerRecord = { name: string; state: PeerState; link: PeerLink; channel: RTCDataChannel | null }

const EMPTY: RoomSnapshot = {
  socketStatus: 'connecting',
  notice: '',
  selfName: '',
  peers: [],
  incoming: [],
  outgoing: [],
}

export function createRoomStore(options: { code: string; peerId: string; name: string }) {
  const listeners = new Set<() => void>()
  const peers = new Map<string, PeerRecord>()
  const incoming = new Map<string, IncomingInternal>()
  const outgoing = new Map<string, OutgoingInternal>()
  const sendQueues = new Map<string, Promise<void>>()
  const pendingSignals = new Map<string, SignalData[]>()
  let socketStatus: RoomSnapshot['socketStatus'] = 'connecting'
  let notice = ''
  let selfName = options.name
  let alive = true
  let lastEmit = 0
  let emitTimer = 0
  let snapshot: RoomSnapshot = { ...EMPTY, selfName }

  const socket = openSignaling({
    onStatus: (status) => {
      socketStatus = status
      if (status === 'closed') notice = notice || 'The connection dropped. Refresh to join again.'
      emit(true)
    },
    onMessage: (message) => {
      handleServer(message)
    },
  })

  socket.send({ type: 'join', room: options.code, peerId: options.peerId, name: options.name })

  function build(): RoomSnapshot {
    return {
      socketStatus,
      notice,
      selfName,
      peers: [...peers.entries()]
        .map(([id, peer]) => ({ id, name: peer.name, state: peer.state }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      incoming: [...incoming.values()].map((item) => ({
        id: item.id,
        fromId: item.fromId,
        name: item.name,
        size: item.size,
        mime: item.mime,
        preview: item.preview,
        received: item.received,
        status: item.status,
        error: item.error,
        downloadUrl: item.downloadUrl,
      })),
      outgoing: [...outgoing.values()].map((item) => ({
        id: item.id,
        name: item.name,
        size: item.size,
        mime: item.mime,
        targets: item.targets.map((target) => ({ ...target })),
      })),
    }
  }

  function emit(force = false) {
    if (!alive) return
    const now = performance.now()
    if (!force && now - lastEmit < 100) {
      if (!emitTimer) {
        emitTimer = window.setTimeout(() => {
          emitTimer = 0
          emit(true)
        }, 100)
      }
      return
    }
    if (emitTimer) {
      window.clearTimeout(emitTimer)
      emitTimer = 0
    }
    lastEmit = now
    snapshot = build()
    for (const listener of listeners) listener()
  }

  function isSignal(data: unknown): data is SignalData {
    if (!data || typeof data !== 'object') return false
    const signal = data as { kind?: unknown; sdp?: unknown; candidate?: unknown }
    if ((signal.kind === 'offer' || signal.kind === 'answer') && typeof signal.sdp === 'string') return true
    return signal.kind === 'ice' && typeof signal.candidate === 'object' && signal.candidate !== null
  }

  function wireChannel(peerId: string, channel: RTCDataChannel) {
    const peer = peers.get(peerId)
    if (!peer) return
    peer.channel = channel
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => {
      const current = peers.get(peerId)
      if (!current) return
      current.state = 'connected'
      if (notice === 'Wait until someone is connected.' || notice === 'Wait until they are connected.') notice = ''
      emit(true)
    }
    channel.onclose = () => {
      failTransfers(peerId, 'The connection closed.')
      const current = peers.get(peerId)
      if (current && current.state === 'connecting') current.state = 'closed'
      emit(true)
    }
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed: unknown = JSON.parse(event.data)
          if (isControlMessage(parsed)) handleControl(peerId, parsed)
        } catch {
          // Ignore malformed file messages.
        }
        return
      }
      if (event.data instanceof ArrayBuffer) handleChunk(peerId, event.data)
    }
  }

  function ensurePeer(id: string, name: string, role: 'offerer' | 'answerer') {
    const existing = peers.get(id)
    if (existing) {
      existing.name = name
      return existing
    }
    const link = createPeerLink({
      onSignal: (data) => socket.send({ type: 'signal', to: id, data }),
      onChannel: (channel) => wireChannel(id, channel),
      onState: (state) => {
        const peer = peers.get(id)
        if (!peer) return
        if (state === 'failed' || state === 'disconnected') {
          peer.state = 'failed'
          failTransfers(id, 'Could not connect directly.')
        } else if (state === 'closed') {
          peer.state = 'closed'
        } else if (state === 'connected' && peer.channel?.readyState === 'open') {
          peer.state = 'connected'
        }
        emit(true)
      },
    })
    const record: PeerRecord = { name, state: 'connecting', link, channel: null }
    peers.set(id, record)
    window.setTimeout(() => {
      if (!alive) return
      const peer = peers.get(id)
      if (peer && peer.state === 'connecting') {
        peer.state = 'failed'
        failTransfers(id, 'Could not connect directly.')
        emit(true)
      }
    }, 20_000)
    if (role === 'offerer') {
      link.start().catch(() => {
        record.state = 'failed'
        emit(true)
      })
    }
    const queued = pendingSignals.get(id) ?? []
    pendingSignals.delete(id)
    for (const data of queued) {
      link.handleSignal(data).catch(() => {
        record.state = 'failed'
        emit(true)
      })
    }
    return record
  }

  function handleServer(message: ServerMessage) {
    if (message.type === 'error') {
      notice = message.message
      emit(true)
      return
    }
    if (message.type === 'joined') {
      for (const peer of message.peers) ensurePeer(peer.id, peer.name, 'offerer')
      emit(true)
      return
    }
    if (message.type === 'peer-joined') {
      ensurePeer(message.peer.id, message.peer.name, 'answerer')
      emit(true)
      return
    }
    if (message.type === 'peer-left') {
      const peer = peers.get(message.peerId)
      peer?.link.close()
      peers.delete(message.peerId)
      failTransfers(message.peerId, 'They left the room.')
      emit(true)
      return
    }
    if (message.type === 'peer-renamed') {
      const peer = peers.get(message.peerId)
      if (peer) peer.name = message.name
      emit(true)
      return
    }
    if (message.type === 'signal' && isSignal(message.data)) {
      const peer = peers.get(message.from)
      if (!peer) {
        const queued = pendingSignals.get(message.from) ?? []
        queued.push(message.data)
        pendingSignals.set(message.from, queued)
        ensurePeer(message.from, 'Guest', 'answerer')
        emit(true)
        return
      }
      peer.link.handleSignal(message.data).catch(() => {
        peer.state = 'failed'
        emit(true)
      })
    }
  }

  function failTransfers(peerId: string, message: string) {
    for (const item of incoming.values()) {
      if (item.fromId === peerId && (item.status === 'offered' || item.status === 'receiving')) {
        item.status = 'error'
        item.error = message
        item.parts = []
      }
    }
    for (const item of outgoing.values()) {
      for (const target of item.targets) {
        if (target.peerId === peerId && (target.status === 'waiting' || target.status === 'sending')) {
          target.status = 'error'
          target.error = message
        }
      }
    }
  }

  function enqueue(peerId: string, task: () => Promise<void>) {
    const previous = sendQueues.get(peerId) ?? Promise.resolve()
    const next = previous.then(task, task)
    sendQueues.set(peerId, next)
  }

  function offerFile(file: File, targetIds: string[]) {
    const id = crypto.randomUUID()
    const name = cleanFileName(file.name)
    const mime = file.type || 'application/octet-stream'
    const item: OutgoingInternal = {
      id,
      file,
      name,
      size: file.size,
      mime,
      targets: targetIds.map((peerId) => ({ peerId, sent: 0, status: 'waiting' })),
    }
    outgoing.set(id, item)
    emit(true)
    void (async () => {
      const preview = await makePreview(file)
      if (!alive) return
      for (const target of item.targets) {
        const channel = peers.get(target.peerId)?.channel
        if (!channel || channel.readyState !== 'open') {
          target.status = 'error'
          target.error = 'Not connected'
          continue
        }
        const payload: ControlMessage = { type: 'file-offer', id, name, size: file.size, mime }
        if (preview) payload.preview = preview
        channel.send(JSON.stringify(payload))
      }
      emit(true)
    })()
  }

  function handleControl(fromId: string, message: ControlMessage) {
    if (message.type === 'file-offer') {
      incoming.set(message.id, {
        id: message.id,
        fromId,
        name: cleanFileName(message.name),
        size: message.size,
        mime: message.mime || 'application/octet-stream',
        preview: safePreview(message.preview),
        received: 0,
        status: 'offered',
        parts: [],
      })
      emit(true)
      return
    }
    if (message.type === 'file-accept') {
      const item = outgoing.get(message.id)
      const target = item?.targets.find((entry) => entry.peerId === fromId)
      if (!item || !target || target.status === 'sending' || target.status === 'done') return
      target.status = 'sending'
      emit(true)
      enqueue(fromId, async () => {
        const channel = peers.get(fromId)?.channel
        if (!channel || channel.readyState !== 'open') {
          target.status = 'error'
          target.error = 'Not connected'
          emit(true)
          return
        }
        try {
          await sendFile(channel, item.id, item.file, (sent) => {
            target.sent = sent
            emit(false)
          })
          target.status = 'done'
          target.sent = item.size
        } catch (error) {
          target.status = 'error'
          target.error = error instanceof Error ? error.message : 'Send failed'
        }
        emit(true)
      })
      return
    }
    if (message.type === 'file-decline') {
      const target = outgoing.get(message.id)?.targets.find((entry) => entry.peerId === fromId)
      if (target && target.status === 'waiting') target.status = 'declined'
      emit(true)
      return
    }
    if (message.type === 'file-done') finishIncoming(message.id)
  }

  function handleChunk(fromId: string, buffer: ArrayBuffer) {
    const unpacked = unpackChunk(buffer)
    if (!unpacked) return
    const item = incoming.get(unpacked.fileId)
    if (!item || item.fromId !== fromId || item.status !== 'receiving') return
    if (item.received + unpacked.data.byteLength > item.size) {
      item.status = 'error'
      item.error = 'The file did not match what was offered.'
      item.parts = []
      emit(true)
      return
    }
    const copy = new ArrayBuffer(unpacked.data.byteLength)
    new Uint8Array(copy).set(unpacked.data)
    item.parts.push(copy)
    item.received += copy.byteLength
    emit(false)
  }

  function finishIncoming(fileId: string) {
    const item = incoming.get(fileId)
    if (!item || item.status !== 'receiving') return
    if (item.received !== item.size) {
      item.status = 'error'
      item.error = 'The file arrived incomplete.'
      item.parts = []
      emit(true)
      return
    }
    const blob = new Blob(item.parts, { type: item.mime || 'application/octet-stream' })
    item.parts = []
    item.downloadUrl = URL.createObjectURL(blob)
    item.status = 'done'
    saveUrl(item.downloadUrl, item.name)
    emit(true)
  }

  function connectedIds() {
    return [...peers.entries()]
      .filter(([, peer]) => peer.channel?.readyState === 'open')
      .map(([id]) => id)
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return snapshot
    },
    accept(fileId: string) {
      const item = incoming.get(fileId)
      if (!item || item.status !== 'offered') return
      const channel = peers.get(item.fromId)?.channel
      if (!channel || channel.readyState !== 'open') {
        item.status = 'error'
        item.error = 'Not connected'
        emit(true)
        return
      }
      item.status = 'receiving'
      const acceptMessage: ControlMessage = { type: 'file-accept', id: fileId }
      channel.send(JSON.stringify(acceptMessage))
      emit(true)
    },
    decline(fileId: string) {
      const item = incoming.get(fileId)
      if (!item || item.status !== 'offered') return
      item.status = 'declined'
      item.parts = []
      const channel = peers.get(item.fromId)?.channel
      if (channel && channel.readyState === 'open') {
        const declineMessage: ControlMessage = { type: 'file-decline', id: fileId }
        channel.send(JSON.stringify(declineMessage))
      }
      emit(true)
    },
    saveAgain(fileId: string) {
      const item = incoming.get(fileId)
      if (item?.downloadUrl) saveUrl(item.downloadUrl, item.name)
    },
    sendFiles(files: File[], target: 'all' | string) {
      const openIds = connectedIds()
      const targets = target === 'all' ? openIds : openIds.filter((id) => id === target)
      if (targets.length === 0) {
        notice = target === 'all' ? 'Wait until someone is connected.' : 'Wait until they are connected.'
        emit(true)
        return
      }
      notice = ''
      for (const file of files) offerFile(file, targets)
    },
    rename(name: string) {
      const trimmed = name.trim().slice(0, 32)
      if (!trimmed) return
      selfName = trimmed
      setDisplayName(trimmed)
      socket.send({ type: 'rename', name: trimmed })
      emit(true)
    },
    close() {
      alive = false
      if (emitTimer) window.clearTimeout(emitTimer)
      for (const item of incoming.values()) {
        if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl)
      }
      for (const peer of peers.values()) peer.link.close()
      socket.close()
      listeners.clear()
    },
  }
}

export type RoomStore = ReturnType<typeof createRoomStore>
