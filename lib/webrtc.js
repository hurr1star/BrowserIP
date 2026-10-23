// WebRTC leak test: WebRTC traffic can bypass the browser's proxy settings,
// so the public address a STUN server sees may differ from the browser's
// HTTP egress address.

const STUN_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

function normalizeIp(ip) {
  return ip.toLowerCase().replace(/^\[|\]$/g, "");
}

// Parses an ICE candidate line such as
// "candidate:842163049 1 udp 1677729535 203.0.113.5 54321 typ srflx ...".
export function parseCandidate(line) {
  const parts = line.replace(/^a=/, "").trim().split(/\s+/);
  const typIndex = parts.indexOf("typ");
  if (parts.length < 8 || typIndex === -1) {
    return null;
  }
  return { address: normalizeIp(parts[4]), type: parts[typIndex + 1] };
}

export function analyzeCandidates(lines, knownIps) {
  const known = new Set(knownIps.map(normalizeIp));
  const publicIps = new Set();
  const localIps = new Set();

  for (const line of lines) {
    const candidate = parseCandidate(line);
    if (!candidate) {
      continue;
    }
    if (candidate.type === "srflx" || candidate.type === "prflx") {
      publicIps.add(candidate.address);
    } else if (candidate.type === "host" && !candidate.address.endsWith(".local")) {
      // Browsers hide host addresses behind mDNS names (*.local) by default.
      localIps.add(candidate.address);
    }
  }

  return {
    publicIps: [...publicIps],
    localIps: [...localIps],
    leaked: [...publicIps].filter((ip) => !known.has(ip))
  };
}

export async function gatherCandidates({ timeoutMs = 5000 } = {}) {
  if (typeof RTCPeerConnection === "undefined") {
    throw new Error("WebRTC is disabled in this browser");
  }

  const connection = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  const lines = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, timeoutMs);
      connection.addEventListener("icecandidate", (event) => {
        if (event.candidate) {
          lines.push(event.candidate.candidate);
        } else {
          clearTimeout(timer);
          resolve();
        }
      });
      connection.createDataChannel("browserip");
      connection
        .createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  } finally {
    connection.close();
  }
  return lines;
}
