// Turns normalized lookup results into a connection verdict.
//
// Overall states:
//   "tunnelled" - every address with known flags exits through a VPN, proxy,
//                 Tor or hosting network
//   "direct"    - every address with known flags is a residential/ISP address
//   "leak"      - some addresses are tunnelled and others are not (for example
//                 IPv4 goes through the VPN but IPv6 does not)
//   "unknown"   - no address had usable anonymizer flags

export function classifyAddress(info) {
  const flags = info?.flags ?? {};
  const reasons = [];

  if (flags.vpn === true) {
    reasons.push(info.vpnService ? `VPN (${info.vpnService})` : "VPN");
  }
  if (flags.tor === true) {
    reasons.push("Tor exit node");
  }
  if (flags.proxy === true) {
    reasons.push("Proxy");
  }
  // Most VPN, Tor and proxy exits are also hosting addresses; only name the
  // hosting network when it is the sole signal (e.g. a self-hosted VPN).
  if (flags.datacenter === true && !reasons.length) {
    reasons.push(info.datacenterName ? `Hosting network (${info.datacenterName})` : "Hosting network");
  }

  if (reasons.length) {
    return { tunnelled: true, reasons };
  }

  const known = [flags.vpn, flags.tor, flags.proxy, flags.datacenter];
  if (known.every((value) => value === false)) {
    return { tunnelled: false, reasons: [] };
  }
  return { tunnelled: null, reasons: [] };
}

export function summarize(addresses) {
  const classified = addresses.map((address) => ({
    ...address,
    ...classifyAddress(address.info)
  }));

  const known = classified.filter((address) => address.tunnelled !== null);
  let overall = "unknown";
  if (known.length) {
    const tunnelled = known.filter((address) => address.tunnelled);
    if (tunnelled.length === known.length) {
      overall = "tunnelled";
    } else if (tunnelled.length === 0) {
      overall = "direct";
    } else {
      overall = "leak";
    }
  }

  return { overall, addresses: classified };
}
