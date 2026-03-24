/**
 * WebRTC Peer Connection wrapper
 *
 * Handles:
 * - RTCPeerConnection lifecycle
 * - ICE candidate gathering
 * - Video stream (screen share from desktop)
 * - Data channel (commands, BYOK keys transfer)
 *
 * Uses public STUN servers for NAT traversal.
 */

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// TODO: Implement peer connection wrapper in next phase
