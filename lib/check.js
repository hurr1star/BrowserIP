import { classifyAddress, summarize } from "./classify.js";
import { fetchMullvadCheck } from "./mullvad.js";
import { fetchAddress, fetchSecondOpinion, ipFamily, lookupIp } from "./providers.js";

// Full lookups count against the provider's daily quota, so a background
// check reuses the previous lookup while the browser's addresses are
// unchanged and the lookup is younger than this.
export const LOOKUP_TTL_MS = 6 * 60 * 60 * 1000;

function sameIps(a, b) {
  return a.length === b.length && a.every((ip, index) => ip === b[index]);
}

async function lookupAddresses(ips, { fetchImpl, keys }) {
  const results = await Promise.allSettled(ips.map((ip) => lookupIp(ip, { fetchImpl, keys })));
  if (results.every((result) => result.status === "rejected")) {
    throw results[0].reason;
  }
  return results.map((result, index) => ({
    ip: ips[index],
    family: ipFamily(ips[index]),
    info: result.status === "fulfilled" ? result.value : null,
    error: result.status === "rejected" ? result.reason.message : null
  }));
}

// Attaches Mullvad's verdict to each address it reports on. Mullvad only
// checks the caller's own address, once per IP family.
async function addMullvadChecks(addresses, { fetchImpl }) {
  const families = [...new Set(addresses.map((address) => address.family).filter(Boolean))];
  const checks = await Promise.all(families.map((family) => fetchMullvadCheck(family, { fetchImpl })));
  const byIp = new Map(checks.filter(Boolean).map((check) => [check.ip, check]));
  return addresses.map((address) => {
    const mullvad = byIp.get(address.ip.toLowerCase());
    if (!mullvad) {
      return address;
    }
    const info = address.info ?? { provider: "am.i.mullvad.net", flags: {} };
    return { ...address, info: { ...info, mullvad } };
  });
}

// Asks the second database about every looked-up address the first one did
// not flag as tunnelled.
async function addSecondOpinions(addresses, { fetchImpl, keys }) {
  return Promise.all(
    addresses.map(async (address) => {
      if (!address.info || classifyAddress(address.info).tunnelled === true) {
        return address;
      }
      const secondOpinion = await fetchSecondOpinion(address.ip, { fetchImpl, keys });
      return { ...address, info: { ...address.info, secondOpinion } };
    })
  );
}

// Runs one connection check and returns the new state. Never throws: on
// failure it returns the previous data with `ok: false` and the error, so
// the UI can keep showing the last known result marked as out of date.
export async function runCheck({
  previous = null,
  settings,
  keys = {},
  force = false,
  now = Date.now(),
  fetchImpl = fetch
}) {
  try {
    const families = settings.checkIpv6 ? ["IPv4", "IPv6"] : ["IPv4"];
    const found = await Promise.all(families.map((family) => fetchAddress(family, { fetchImpl })));
    const ips = found.filter(Boolean);
    const previousIps = previous?.addresses?.map((address) => address.ip) ?? [];

    let addresses;
    let lookedUpAt = now;
    if (
      !force &&
      ips.length &&
      previous?.ok &&
      sameIps(ips, previousIps) &&
      now - previous.lookedUpAt < LOOKUP_TTL_MS
    ) {
      addresses = previous.addresses.map(({ ip, family, info, error }) => ({ ip, family, info, error }));
      lookedUpAt = previous.lookedUpAt;
    } else {
      if (ips.length) {
        addresses = await lookupAddresses(ips, { fetchImpl, keys });
      } else {
        // The address endpoints are unreachable; let the lookup provider
        // report whichever address the browser reaches it from.
        const info = await lookupIp(null, { fetchImpl, keys });
        addresses = [{ ip: info.ip, family: info.family, info, error: null }];
      }
      if (settings.vpnProvider === "mullvad") {
        addresses = await addMullvadChecks(addresses, { fetchImpl });
      }
      if (settings.secondOpinion) {
        addresses = await addSecondOpinions(addresses, { fetchImpl, keys });
      }
    }

    const summary = summarize(addresses);
    return {
      ok: true,
      error: null,
      checkedAt: now,
      lookedUpAt,
      overall: summary.overall,
      addresses: summary.addresses
    };
  } catch (error) {
    return {
      ...(previous ?? { overall: "unknown", addresses: [], checkedAt: null, lookedUpAt: null }),
      ok: false,
      error: error?.message || String(error),
      failedAt: now
    };
  }
}

// Looks up any address the user asks about and classifies it.
export async function lookupAddress(ip, { settings, keys = {}, fetchImpl = fetch }) {
  const info = await lookupIp(ip, { fetchImpl, keys });
  let addresses = [{ ip: info.ip, family: info.family, info, error: null }];
  if (settings.secondOpinion) {
    addresses = await addSecondOpinions(addresses, { fetchImpl, keys });
  }
  return summarize(addresses).addresses[0];
}
