export type SignalData =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

export type PeerLink = {
  start: () => Promise<void>
  handleSignal: (data: SignalData) => Promise<void>
  close: () => void
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export function createPeerLink(options: {
  onSignal: (data: SignalData) => void
  onChannel: (channel: RTCDataChannel) => void
  onState: (state: RTCPeerConnectionState) => void
}): PeerLink {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  let remoteReady = false
  const pendingIce: RTCIceCandidateInit[] = []

  pc.onicecandidate = (event) => {
    if (event.candidate) options.onSignal({ kind: 'ice', candidate: event.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => options.onState(pc.connectionState)
  pc.ondatachannel = (event) => options.onChannel(event.channel)

  async function flushIce() {
    while (pendingIce.length > 0) {
      const candidate = pendingIce.shift()
      if (candidate) await pc.addIceCandidate(candidate)
    }
  }

  return {
    async start() {
      const channel = pc.createDataChannel('files', { ordered: true })
      options.onChannel(channel)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      options.onSignal({ kind: 'offer', sdp: pc.localDescription?.sdp ?? '' })
    },
    async handleSignal(data) {
      if (data.kind === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        remoteReady = true
        await flushIce()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        options.onSignal({ kind: 'answer', sdp: pc.localDescription?.sdp ?? '' })
        return
      }
      if (data.kind === 'answer') {
        if (pc.signalingState !== 'have-local-offer') return
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        remoteReady = true
        await flushIce()
        return
      }
      if (!remoteReady) pendingIce.push(data.candidate)
      else await pc.addIceCandidate(data.candidate)
    },
    close() {
      pc.onicecandidate = null
      pc.ondatachannel = null
      pc.close()
    },
  }
}
