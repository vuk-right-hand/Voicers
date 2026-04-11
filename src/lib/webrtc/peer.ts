/**
 * WebRTC Peer Connection — phone side (THE CALLER).
 *
 * Phone creates the data channel BEFORE the SDP offer so it's included
 * in the initial handshake. Host receives it via ondatachannel.
 */

import type { SignalingData } from "@/types";
import { updateSignalingData, subscribeToSession } from "./signaling";

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export interface PeerConnection {
  stream: MediaStream;
  dataChannel: RTCDataChannel;
  pc: RTCPeerConnection;
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
  iceServers: RTCIceServer[] = FALLBACK_ICE,
  onRejected?: (reason: string) => void,
): { pc: RTCPeerConnection; close: () => void } {
  const pc = new RTCPeerConnection({ iceServers });
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

  // 4. ICE candidates are gathered and embedded in the SDP offer (vanilla ICE).
  //    No trickle — Supabase single-column signaling can't reliably deliver
  //    rapid individual candidate writes.

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
    if (data.type === "rejected") {
      channel?.unsubscribe();
      channel = null;
      dataChannel.close();
      pc.close();
      onRejected?.(data.reason);
      return;
    }

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

  // 7. Create offer, wait for ALL ICE candidates, then send to host.
  //    Chrome gathers candidates asynchronously (trickle ICE). Sending them
  //    one-by-one through Supabase signaling_data overwrites is unreliable —
  //    events get coalesced/lost. Instead we wait for gathering to finish so
  //    all candidates (host, srflx, relay) are embedded in the offer SDP.
  (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (all candidates collected)
      if (pc.iceGatheringState !== "complete") {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (pc.iceGatheringState === "complete") {
              pc.removeEventListener("icegatheringstatechange", check);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", check);
          // Safety timeout — don't block forever if gathering stalls
          setTimeout(resolve, 10_000);
        });
      }

      // pc.localDescription now has all gathered candidates baked in
      const { error } = await updateSignalingData(sessionId, {
        type: "offer",
        sdp: pc.localDescription!.sdp,
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
    pc,
    close: () => {
      channel?.unsubscribe();
      dataChannel.close();
      pc.close();
    },
  };
}
