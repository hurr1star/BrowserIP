export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatAge(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatAsn(info) {
  if (!info?.asn) {
    return info?.asnOrg || null;
  }
  return info.asnOrg ? `AS${info.asn} · ${info.asnOrg}` : `AS${info.asn}`;
}

export function formatLocation(info) {
  const parts = [info?.city, info?.region].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
