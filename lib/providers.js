// IP lookup providers. Each provider builds a request URL and normalizes its
// response into one shared shape so the rest of the extension never touches
// provider-specific fields.

export const REQUEST_TIMEOUT_MS = 8000;

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch (_error) {
    return null;
  }
})();

function bool(value) {
  return typeof value === "boolean" ? value : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function countryName(code) {
  if (!code || !countryNames) {
    return null;
  }
  try {
    return countryNames.of(code.toUpperCase()) || null;
  } catch (_error) {
    return null;
  }
}

export function ipFamily(ip) {
  if (!ip) {
    return null;
  }
  return ip.includes(":") ? "IPv6" : "IPv4";
}

const UNKNOWN_FLAGS = Object.freeze({
  vpn: null,
  proxy: null,
  tor: null,
  datacenter: null,
  mobile: null,
  abuser: null
});

export const PROVIDERS = [
  {
    name: "ipapi.is",
    url: (ip) => (ip ? `https://api.ipapi.is/?q=${encodeURIComponent(ip)}` : "https://api.ipapi.is/"),
    normalize(data) {
      if (text(data.error)) {
        throw new Error(data.error);
      }
      const asnNumber = Number.isInteger(data.asn?.asn) ? data.asn.asn : null;
      return {
        ip: text(data.ip),
        city: text(data.location?.city),
        region: text(data.location?.state),
        country: text(data.location?.country) || countryName(data.location?.country_code),
        countryCode: text(data.location?.country_code)?.toUpperCase() ?? null,
        timezone: text(data.location?.timezone),
        isp: text(data.company?.name) || text(data.asn?.org),
        asn: asnNumber,
        asnOrg: text(data.asn?.org),
        flags: {
          vpn: bool(data.is_vpn),
          proxy: bool(data.is_proxy),
          tor: bool(data.is_tor),
          datacenter: bool(data.is_datacenter),
          mobile: bool(data.is_mobile),
          abuser: bool(data.is_abuser)
        },
        vpnService: text(data.vpn?.service),
        datacenterName: text(data.datacenter?.datacenter)
      };
    }
  },
  {
    name: "ipwho.is",
    url: (ip) => `https://ipwho.is/${ip ? encodeURIComponent(ip) : ""}`,
    normalize(data) {
      if (data.success === false) {
        throw new Error(text(data.message) || "lookup failed");
      }
      return {
        ip: text(data.ip),
        city: text(data.city),
        region: text(data.region),
        country: text(data.country) || countryName(data.country_code),
        countryCode: text(data.country_code)?.toUpperCase() ?? null,
        timezone: text(data.timezone?.id),
        isp: text(data.connection?.isp) || text(data.connection?.org),
        asn: Number.isInteger(data.connection?.asn) ? data.connection.asn : null,
        asnOrg: text(data.connection?.org),
        // The free tier has no anonymizer data.
        flags: { ...UNKNOWN_FLAGS },
        vpnService: null,
        datacenterName: null
      };
    }
  },
  {
    name: "ipinfo.io",
    url: (ip) => `https://ipinfo.io/${ip ? `${encodeURIComponent(ip)}/` : ""}json`,
    normalize(data) {
      if (data.error) {
        throw new Error(text(data.error.message) || text(data.error.title) || "lookup failed");
      }
      // "org" looks like "AS15169 Google LLC".
      const orgMatch = /^AS(\d+)\s+(.*)$/.exec(text(data.org) || "");
      return {
        ip: text(data.ip),
        city: text(data.city),
        region: text(data.region),
        country: countryName(data.country),
        countryCode: text(data.country)?.toUpperCase() ?? null,
        timezone: text(data.timezone),
        isp: orgMatch ? text(orgMatch[2]) : text(data.org),
        asn: orgMatch ? Number(orgMatch[1]) : null,
        asnOrg: orgMatch ? text(orgMatch[2]) : text(data.org),
        flags: { ...UNKNOWN_FLAGS },
        vpnService: null,
        datacenterName: null
      };
    }
  }
];

export async function fetchJson(url, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new Error(`timed out after ${timeoutMs / 1000}s`, { cause: error });
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

// Looks up `ip` (or the caller's own address when `ip` is null), trying each
// provider in order until one succeeds.
export async function lookupIp(ip, { fetchImpl = fetch, providers = PROVIDERS } = {}) {
  const failures = [];
  for (const provider of providers) {
    try {
      const data = await fetchJson(provider.url(ip), { fetchImpl });
      const info = provider.normalize(data);
      if (!info.ip) {
        throw new Error("response has no IP address");
      }
      return { ...info, family: ipFamily(info.ip), provider: provider.name };
    } catch (error) {
      failures.push(`${provider.name}: ${error.message}`);
    }
  }
  throw new Error(`All IP providers failed (${failures.join("; ")})`);
}

const ADDRESS_ENDPOINTS = {
  IPv4: "https://api4.ipify.org/?format=json",
  IPv6: "https://api6.ipify.org/?format=json"
};

// Returns the browser's public address for one IP family, or null when the
// network has no route for that family.
export async function fetchAddress(family, { fetchImpl = fetch } = {}) {
  try {
    const data = await fetchJson(ADDRESS_ENDPOINTS[family], { fetchImpl, timeoutMs: 5000 });
    const ip = text(data.ip);
    return ip && ipFamily(ip) === family ? ip : null;
  } catch (_error) {
    return null;
  }
}
