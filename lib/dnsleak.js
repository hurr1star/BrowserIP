// DNS leak test using bash.ws (the service behind the open-source
// "dnsleaktest" scripts). Looking up unique hostnames makes whichever DNS
// resolvers the browser uses contact bash.ws, which then reports them.
import { fetchJson } from "./providers.js";

const BASE = "https://bash.ws";
const PROBES = 10;

export async function runDnsLeakTest({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${BASE}/id`, {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const id = (await response.text()).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error("unexpected test id");
  }

  // Only the DNS lookups matter; the HTTPS requests themselves may fail.
  await Promise.allSettled(
    Array.from({ length: PROBES }, (_, index) =>
      fetchImpl(`https://${index + 1}.${id}.bash.ws/`, {
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(4000)
      })
    )
  );

  const entries = await fetchJson(`${BASE}/dnsleak/test/${id}?json`, { fetchImpl });
  // `entries` is the raw response, for the self-test.
  return { ...analyzeDnsLeak(entries), entries };
}

export function analyzeDnsLeak(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("unexpected response");
  }
  const describe = (entry) => ({
    ip: entry.ip,
    country: entry.country_name || entry.country || null,
    asn: entry.asn || null
  });
  const servers = entries.filter((entry) => entry.type === "dns").map(describe);
  const conclusion = entries.find((entry) => entry.type === "conclusion")?.ip || null;
  let leaking = null;
  if (conclusion) {
    leaking = /not leaking/i.test(conclusion) ? false : /leak/i.test(conclusion);
  }
  return {
    servers,
    yourIps: entries.filter((entry) => entry.type === "ip").map(describe),
    conclusion,
    leaking
  };
}
