const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIpAddress(value) {
  if (typeof value !== "string") {
    return false;
  }
  if (IPV4.test(value)) {
    return true;
  }
  if (!value.includes(":") || !/^[0-9a-fA-F:.]+$/.test(value)) {
    return false;
  }
  // The URL parser implements the full IPv6 grammar.
  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch (_error) {
    return false;
  }
}

// Finds the first IP address in free text, e.g. a selection such as
// "Connection from 203.0.113.5:443 refused".
export function findIpAddress(text) {
  for (const raw of String(text ?? "").split(/[\s,;()<>"'`]+/)) {
    const token = raw.replace(/^\[|\]$/g, "").replace(/[.:]+$/, "");
    if (isIpAddress(token)) {
      return token.toLowerCase();
    }
    const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(token) || /^\[([^\]]+)\]:\d+$/.exec(raw);
    if (withPort && isIpAddress(withPort[1])) {
      return withPort[1].toLowerCase();
    }
  }
  return null;
}
