/**
 * WebRTC Peer Connection — phone side (THE CALLER).
 *
 * Phone creates the data channel BEFORE the SDP offer so it's included
 * in the initial handshake. Host receives it via ondatachannel.
 */

import type { SignalingData } from "@/types";
import { updateSignalingData, subscribeToSession } from "./signaling";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export interface PeerConnection {
  stream: MediaStream;
  dataChannel: RTCDataChannel;
  close: () => void;
}

/**
 * Initiate a WebRTC call to the host.
 * Phone is the caller — creates offer + data channel.
 */
export function initiateCall(
  sessionId: string,
  onStream: (stream: MediaStream) => void,
  onDataChannel: (dc: RTCDataChannel) => void,
  onStateChange: (state: RTCPeerConnectionState) => void,
): { close: () => void } {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const iceQueue: RTCIceCandidateInit[] = [];
  let remoteDescriptionSet = false;
  let channel: ReturnType<typeof subscribeToSession> | null = null;

  // 1. Declare we want to RECEIVE video (adds m=video recvonly to SDP offer)
  pc.addTransceiver("video", { direction: "recvonly" });

  // 2. Create data channel BEFORE generating offer
  const dataChannel = pc.createDataChannel("commands", { ordered: true });

  dataChannel.onopen = () => onDataChannel(dataChannel);

  // 3. Handle incoming video track from host
  pc.ontrack = (event) => {
    // aiortc may not associate tracks with streams, so create one if needed
    const stream = event.streams[0] || new MediaStream([event.track]);
    onStream(stream);
  };

  // 4. Send our ICE candidates to host via Supabase
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      updateSignalingData(sessionId, {
        type: "ice-candidate",
        candidate: JSON.stringify(event.candidate.toJSON()),
        from: "phone",
      });
    }
  };

  // 5. Track connection state
  pc.onconnectionstatechange = () => {
    onStateChange(pc.connectionState);
    if (pc.connectionState === "connected") {
      // Signaling done — unsubscribe from Realtime
      channel?.unsubscribe();
      channel = null;
    }
  };

  // 6. Subscribe to signaling for answer + host ICE candidates
  //    Use unique suffix so dashboard cleanup doesn't kill this subscription
  channel = subscribeToSession(sessionId, async (data: SignalingData) => {
    if (data.type === "answer" && data.from === "host") {
      const answer = new RTCSessionDescription({ type: "answer", sdp: data.sdp });
      await pc.setRemoteDescription(answer);
      remoteDescriptionSet = true;

      // Flush queued ICE candidates
      for (const candidate of iceQueue) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      iceQueue.length = 0;
    }

    if (data.type === "ice-candidate" && data.from === "host") {
      const candidate: RTCIceCandidateInit = JSON.parse(data.candidate);
      if (remoteDescriptionSet) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        iceQueue.push(candidate);
      }
    }
  }, undefined, "peer");

  // 7. Create offer and send to host
  (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const { error } = await updateSignalingData(sessionId, {
        type: "offer",
        sdp: offer.sdp!,
        from: "phone",
      });

      if (error) {
        console.error("[peer] Failed to write offer:", error);
      }
    } catch (err) {
      console.error("[peer] Offer error:", err);
    }
  })();

  return {
    close: () => {
      channel?.unsubscribe();
      dataChannel.close();
      pc.close();
    },
  };
}
