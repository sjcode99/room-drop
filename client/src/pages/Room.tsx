import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import QRCode from 'qrcode'
import { formatBytes, kindLabel, percent } from '../lib/format'
import { getDisplayName, getPeerId } from '../lib/names'
import { isRoomCode } from '../lib/code'
import { screenshotFile } from '../lib/transfer'
import { createRoomStore, type RoomStore } from '../lib/room'

export function Room({ code, onLeave }: { code: string; onLeave: () => void }) {
  const [entry, setEntry] = useState<{ code: string; store: RoomStore } | null>(null)

  useEffect(() => {
    if (!isRoomCode(code)) return
    const store = createRoomStore({ code, peerId: getPeerId(), name: getDisplayName() })
    setEntry({ code, store })
    return () => store.close()
  }, [code])

  if (!isRoomCode(code)) {
    return (
      <main className="home">
        <p className="brand">Roomdrop</p>
        <h1>That code is not valid.</h1>
        <button className="primary" type="button" onClick={onLeave}>
          Back home
        </button>
      </main>
    )
  }

  if (!entry || entry.code !== code) {
    return (
      <main className="home">
        <p className="brand">Roomdrop</p>
        <h1>Opening the room…</h1>
      </main>
    )
  }

  return <RoomView code={code} store={entry.store} onLeave={onLeave} />
}

function RoomView({ code, store, onLeave }: { code: string; store: RoomStore; onLeave: () => void }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const link = `${location.origin}/r/${code}`
  const [copied, setCopied] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  const [name, setName] = useState(snap.selfName)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of items) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (!file) continue
        files.push(item.type.startsWith('image/') ? screenshotFile(file) : file)
      }
      if (files.length === 0) return
      event.preventDefault()
      store.sendFiles(files, 'all')
    }
    function prevent(event: DragEvent) {
      event.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [store])

  function takeFiles(fileList: FileList | null, target: 'all' | string) {
    const files = fileList ? [...fileList] : []
    if (files.length === 0) return
    store.sendFiles(files, target)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="room-page">
      <header className="topbar">
        <button className="brand-button" type="button" onClick={onLeave}>
          Roomdrop
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            store.rename(name)
          }}
        >
          <label>
            Your name
            <input
              value={name}
              maxLength={32}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => store.rename(name)}
            />
          </label>
        </form>
      </header>

      <main className="room-grid">
        <section className="share-card">
          <p className="eyebrow">Room code</p>
          <div className="code" aria-label={code}>
            {code.split('').map((letter, index) => (
              <span key={`${letter}-${index}`}>{letter}</span>
            ))}
          </div>
          <div className="share-actions">
            <button className="primary" type="button" onClick={() => void copyLink()}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          </div>
          <QrImage value={link} />
          <p className="quiet">A phone camera opens this room. Files stay on these devices.</p>
        </section>

        <section className="stage">
          {snap.notice ? <p className="notice">{snap.notice}</p> : null}
          <div
            className={over === 'all' ? 'dropwell over' : 'dropwell'}
            onDragOver={(event) => {
              event.preventDefault()
              setOver('all')
            }}
            onDragLeave={() => setOver((current) => (current === 'all' ? null : current))}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setOver(null)
              takeFiles(event.dataTransfer.files, 'all')
            }}
          >
            <h2>Send to everyone here</h2>
            <p>Drop any file, or paste a screenshot.</p>
            <button className="ghost" type="button" onClick={() => fileInput.current?.click()}>
              Choose files
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                takeFiles(event.target.files, 'all')
                event.target.value = ''
              }}
            />
          </div>

          <h2 className="section-title">People</h2>
          {snap.peers.length === 0 ? <p className="quiet">Waiting for someone to join.</p> : null}
          <div className="people">
            <article className="peer you">
              <span className="avatar" style={{ background: hueColor(snap.selfName) }}>
                {initial(snap.selfName)}
              </span>
              <div>
                <strong>{snap.selfName}</strong>
                <span>You</span>
              </div>
            </article>
            {snap.peers.map((peer) => (
              <article
                key={peer.id}
                className={over === peer.id ? 'peer over' : 'peer'}
                onDragOver={(event) => {
                  event.preventDefault()
                  setOver(peer.id)
                }}
                onDragLeave={() => setOver((current) => (current === peer.id ? null : current))}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setOver(null)
                  takeFiles(event.dataTransfer.files, peer.id)
                }}
              >
                <span className="avatar" style={{ background: hueColor(peer.id) }}>
                  {initial(peer.name)}
                </span>
                <div>
                  <strong>{peer.name}</strong>
                  <span>{peerStatus(peer.state)}</span>
                </div>
              </article>
            ))}
          </div>

          {snap.incoming.length > 0 || snap.outgoing.length > 0 ? <h2 className="section-title">Files</h2> : null}
          <div className="files">
            {snap.incoming.map((item) => {
              const from = snap.peers.find((peer) => peer.id === item.fromId)?.name ?? 'Someone who left'
              return (
                <article key={item.id} className="file-card">
                  {item.preview ? <img className="preview" src={item.preview} alt="" /> : null}
                  <div className="file-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {kindLabel(item.name, item.mime)} · {formatBytes(item.size)} · from {from}
                    </span>
                    {item.status === 'receiving' ? <Progress value={percent(item.received, item.size)} /> : null}
                    {item.error ? <span className="problem">{item.error}</span> : null}
                    {item.status === 'done' ? <span>Saved to your downloads. You can save it again.</span> : null}
                    {item.status === 'declined' ? <span>Dismissed.</span> : null}
                  </div>
                  <div className="file-actions">
                    {item.status === 'offered' ? (
                      <>
                        <button className="primary" type="button" onClick={() => store.accept(item.id)}>
                          Download
                        </button>
                        <button className="ghost" type="button" onClick={() => store.decline(item.id)}>
                          Dismiss
                        </button>
                      </>
                    ) : null}
                    {item.status === 'done' && item.downloadUrl ? (
                      <button className="ghost" type="button" onClick={() => store.saveAgain(item.id)}>
                        Download again
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })}
            {snap.outgoing.map((item) => (
              <article key={item.id} className="file-card">
                <div className="file-copy">
                  <strong>{item.name}</strong>
                  <span>
                    {kindLabel(item.name, item.mime)} · {formatBytes(item.size)}
                  </span>
                  {item.targets.map((target) => {
                    const who = snap.peers.find((peer) => peer.id === target.peerId)?.name ?? 'Someone who left'
                    return (
                      <div key={target.peerId} className="target-row">
                        <span>
                          {who} · {targetLabel(target.status, target.error)}
                        </span>
                        {target.status === 'sending' || target.status === 'done' ? (
                          <Progress value={percent(target.sent, item.size)} />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, {
      margin: 1,
      width: 196,
      color: { dark: '#1f1a14', light: '#f7f4ee' },
    })
      .then((url) => {
        if (alive) setSrc(url)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [value])
  if (!src) return <div className="qr skeleton" />
  return <img className="qr" src={src} alt="QR code that opens this room" />
}

function Progress({ value }: { value: number }) {
  return (
    <span className="bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${value}%` }} />
    </span>
  )
}

function initial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function hueColor(seed: string) {
  let hue = 0
  for (const char of seed) hue = (hue * 31 + char.charCodeAt(0)) % 360
  return `hsl(${hue} 38% 36%)`
}

function peerStatus(state: 'connecting' | 'connected' | 'failed' | 'closed') {
  if (state === 'connected') return 'Connected · drop a file here'
  if (state === 'failed') return 'Can’t reach them directly'
  if (state === 'closed') return 'Disconnected'
  return 'Connecting'
}

function targetLabel(status: 'waiting' | 'sending' | 'done' | 'declined' | 'error', error?: string) {
  if (status === 'waiting') return 'Waiting for them to download'
  if (status === 'sending') return 'Sending'
  if (status === 'done') return 'Downloaded'
  if (status === 'declined') return 'Dismissed'
  return error || 'Could not send'
}
