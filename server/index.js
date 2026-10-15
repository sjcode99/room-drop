import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 8787
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/
const MAX_PEERS = 8
const distDir = path.resolve(__dirname, '../client/dist')

/** @type {Map<string, Map<string, { ws: import('ws').WebSocket, name: string }>>} */
const rooms = new Map()

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

const server = http.createServer((req, res) => {
  if (!req.url || req.url.startsWith('/ws')) {
    res.writeHead(426)
    res.end()
    return
  }
  serveStatic(req, res)
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  let roomCode = null
  let peerId = null

  ws.on('message', (raw) => {
    if (raw.length > 200_000) return
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'join') {
      const code = String(msg.room || '').toUpperCase()
      const id = String(msg.peerId || '')
      const name = sanitizeName(msg.name)
      if (!CODE_RE.test(code) || !id || id.length > 80) {
        send(ws, { type: 'error', message: 'That room code is not valid.' })
        return
      }

      let room = rooms.get(code)
      if (!room) {
        room = new Map()
        rooms.set(code, room)
      }

      const previous = room.get(id)
      if (previous && previous.ws !== ws) {
        room.delete(id)
        broadcast(room, id, { type: 'peer-left', peerId: id })
        previous.ws.close()
      } else if (previous && previous.ws === ws) {
        previous.name = name
        send(ws, { type: 'joined', peers: peerList(room, id) })
        broadcast(room, id, { type: 'peer-renamed', peerId: id, name })
        return
      }

      if (room.size >= MAX_PEERS) {
        send(ws, { type: 'error', message: 'This room is full.' })
        return
      }

      if (roomCode && peerId) leave()

      roomCode = code
      peerId = id
      const peers = peerList(room, id)
      room.set(id, { ws, name })
      send(ws, { type: 'joined', peers })
      broadcast(room, id, { type: 'peer-joined', peer: { id, name } })
      return
    }

    if (!roomCode || !peerId) return
    const room = rooms.get(roomCode)
    if (!room || room.get(peerId)?.ws !== ws) return

    if (msg.type === 'rename') {
      const name = sanitizeName(msg.name)
      const self = room.get(peerId)
      if (!self) return
      self.name = name
      broadcast(room, peerId, { type: 'peer-renamed', peerId, name })
      return
    }

    if (msg.type === 'signal') {
      const target = room.get(String(msg.to || ''))
      if (!target || !msg.data || typeof msg.data !== 'object') return
      send(target.ws, { type: 'signal', from: peerId, data: msg.data })
    }
  })

  ws.on('close', () => leave())

  function leave() {
    if (!roomCode || !peerId) return
    const code = roomCode
    const id = peerId
    roomCode = null
    peerId = null
    const room = rooms.get(code)
    if (!room) return
    const current = room.get(id)
    if (!current || current.ws !== ws) return
    room.delete(id)
    broadcast(room, id, { type: 'peer-left', peerId: id })
    if (room.size === 0) rooms.delete(code)
  }
})

function peerList(room, exceptId) {
  const peers = []
  for (const [id, peer] of room) {
    if (id !== exceptId) peers.push({ id, name: peer.name })
  }
  return peers
}

function sanitizeName(name) {
  const clean = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
  return clean || 'Guest'
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(room, exceptId, msg) {
  for (const [id, peer] of room) {
    if (id !== exceptId) send(peer.ws, msg)
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const filePath = resolveStatic(decodeURIComponent(url.pathname))
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
    return
  }
  const index = path.join(distDir, 'index.html')
  if (fs.existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    fs.createReadStream(index).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Roomdrop signaling is running. Open the app with npm run dev.')
}

function resolveStatic(pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const full = path.resolve(distDir, relative)
  if (full !== distDir && !full.startsWith(distDir + path.sep)) return null
  return full
}

server.listen(PORT, () => {
  console.log(`Roomdrop listening on http://localhost:${PORT}`)
})
