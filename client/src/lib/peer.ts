export type SignalData =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

export type PeerLink = {
  start: () => void
  restart: () => void
  handleSignal: (data: SignalData) => Promise<void>
  close: () => void
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

export function createPeerLink(options: {
  polite: boolean
  onSignal: (data: SignalData) => void
  onChannel: (channel: RTCDataChannel) => void
  onState: (state: RTCPeerConnectionState) => void
}): PeerLink {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  let makingOffer = false
  let ignoreOffer = false
  let remoteReady = false
  const pendingIce: RTCIceCandidateInit[] = []

  pc.onicecandidate = (event) => {
    if (event.candidate) options.onSignal({ kind: 'ice', candidate: event.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => options.onState(pc.connectionState)
  pc.ondatachannel = (event) => options.onChannel(event.channel)
  pc.onnegotiationneeded = () => {
    void sendOffer()
  }

  async function sendOffer() {
    try {
      makingOffer = true
      await pc.setLocalDescription()
      const sdp = pc.localDescription?.sdp
      if (sdp) options.onSignal({ kind: 'offer', sdp })
    } finally {
      makingOffer = false
    }
  }

  async function flushIce() {
    const queued = pendingIce.splice(0)
    for (const candidate of queued) await pc.addIceCandidate(candidate)
  }

  return {
    start() {
      const channel = pc.createDataChannel('files', { ordered: true })
      options.onChannel(channel)
    },
    restart() {
      pc.restartIce()
    },
    async handleSignal(data) {
      if (data.kind === 'offer') {
        const collision = makingOffer || pc.signalingState !== 'stable'
        ignoreOffer = !options.polite && collision
        if (ignoreOffer) return
        if (collision) await pc.setLocalDescription({ type: 'rollback' })
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        remoteReady = true
        await flushIce()
        await pc.setLocalDescription()
        const sdp = pc.localDescription?.sdp
        if (sdp) options.onSignal({ kind: 'answer', sdp })
        return
      }
      if (data.kind === 'answer') {
        if (pc.signalingState !== 'have-local-offer') return
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        remoteReady = true
        await flushIce()
        return
      }
      if (!remoteReady || !pc.remoteDescription) pendingIce.push(data.candidate)
      else await pc.addIceCandidate(data.candidate)
    },
    close() {
      pc.onicecandidate = null
      pc.ondatachannel = null
      pc.onnegotiationneeded = null
      pc.close()
    },
  }
}
