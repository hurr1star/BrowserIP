// IP lookup providers. Each provider builds a request URL and normalizes its
// response into one shared shape so the rest of the extension never touches
// provider-specific fields.

export const REQUEST_TIMEOUT_MS = 8000;

function bool(value) {
  return typeof value === "boolean" ? value : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Returns the country name for an ISO code, in `locale` (English by default,
// which keeps provider data in one language).
export function countryName(code, locale = "en") {
  if (!code) {
    return null;
  }
  try {
    return new Intl.DisplayNames([locale], { type: "region", fallback: "none" }).of(code.toUpperCase()) || null;
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
    url(ip, keys = {}) {
      const url = new URL("https://api.ipapi.is/");
      if (ip) {
        url.searchParams.set("q", ip);
      }
      if (keys.ipapi) {
        url.searchParams.set("key", keys.ipapi);
      }
      return url.href;
    },
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
export async function lookupIp(ip, { fetchImpl = fetch, providers = PROVIDERS, keys = {} } = {}) {
  const failures = [];
  for (const provider of providers) {
    try {
      const data = await fetchJson(provider.url(ip, keys), { fetchImpl });
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

// A second VPN database, consulted when ipapi.is finds no anonymizer. Its free
// tier allows about 100 lookups a day without a key (1,000 with a free key).
export const SECOND_OPINION = {
  name: "proxycheck.io",
  url(ip, keys = {}) {
    // IP addresses contain only hex digits, dots and colons, so the path
    // needs no escaping (and proxycheck.io expects literal colons).
    const url = new URL(`https://proxycheck.io/v2/${ip}`);
    url.searchParams.set("vpn", "1");
    url.searchParams.set("asn", "1");
    if (keys.proxycheck) {
      url.searchParams.set("key", keys.proxycheck);
    }
    return url.href;
  },
  normalize(data, ip) {
    if (data.status === "denied" || data.status === "error") {
      throw new Error(text(data.message) || data.status);
    }
    const entry =
      data[ip] ?? Object.values(data).find((value) => value && typeof value === "object" && "proxy" in value);
    if (!entry) {
      throw new Error("response has no result");
    }
    const tunnelled = entry.proxy === "yes" ? true : entry.proxy === "no" ? false : null;
    const type = text(entry.type);
    const operator = text(entry.operator?.name);
    let label = null;
    if (tunnelled) {
      label = type || "Proxy";
      if (operator) {
        label += ` (${operator})`;
      }
    }
    return { provider: this.name, tunnelled, label };
  }
};

// Returns proxycheck.io's verdict for `ip`, or null if it is unavailable.
export async function fetchSecondOpinion(ip, { fetchImpl = fetch, keys = {} } = {}) {
  try {
    const data = await fetchJson(SECOND_OPINION.url(ip, keys), { fetchImpl });
    return SECOND_OPINION.normalize(data, ip);
  } catch (_error) {
    return null;
  }
}
