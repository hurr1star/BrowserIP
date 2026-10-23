// Self-test: calls every live service the extension depends on and checks
// that the response still has the fields the extension reads. Each check
// returns { status: "pass" | "fail" | "info" | "skip", summary, raw }.
import { analyzeDnsLeak, runDnsLeakTest } from "./dnsleak.js";
import { t } from "./i18n.js";
import { callHelper, helperPermitted } from "./mullvad.js";
import { PROVIDERS, SECOND_OPINION, fetchJson } from "./providers.js";
import { analyzeCandidates, gatherCandidates } from "./webrtc.js";

const RAW_LIMIT = 2000;

function raw(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}\n...` : text;
}

function missing(problems, condition, field) {
  if (!condition) {
    problems.push(field);
  }
}

// --- Validators: list the fields the extension relies on that are missing.

export function validateIpify(data) {
  const problems = [];
  missing(problems, typeof data?.ip === "string" && data.ip.length > 0, "ip");
  return problems;
}

export function validateIpapi(data) {
  const problems = [];
  missing(problems, typeof data?.ip === "string", "ip");
  for (const flag of ["is_vpn", "is_proxy", "is_tor", "is_datacenter", "is_abuser"]) {
    missing(problems, typeof data?.[flag] === "boolean", flag);
  }
  missing(problems, typeof data?.location?.country_code === "string", "location.country_code");
  missing(problems, Number.isInteger(data?.asn?.asn), "asn.asn");
  return problems;
}

export function validateIpwhois(data) {
  const problems = [];
  missing(problems, data?.success !== false, "success");
  missing(problems, typeof data?.ip === "string", "ip");
  missing(problems, typeof data?.country_code === "string", "country_code");
  missing(problems, Number.isInteger(data?.connection?.asn), "connection.asn");
  return problems;
}

export function validateIpinfo(data) {
  const problems = [];
  missing(problems, typeof data?.ip === "string", "ip");
  missing(problems, typeof data?.country === "string", "country");
  missing(problems, /^AS\d+ /.test(data?.org ?? ""), "org (AS… name)");
  return problems;
}

export function validateProxycheck(data, ip) {
  const problems = [];
  missing(problems, ["ok", "warning"].includes(data?.status), "status");
  const entry = data?.[ip] ?? Object.values(data ?? {}).find((value) => value && typeof value === "object" && "proxy" in value);
  missing(problems, entry && ["yes", "no"].includes(entry.proxy), `${ip}.proxy`);
  return problems;
}

export function validateMullvad(data) {
  const problems = [];
  missing(problems, typeof data?.ip === "string", "ip");
  missing(problems, typeof data?.mullvad_exit_ip === "boolean", "mullvad_exit_ip");
  missing(problems, typeof data?.blacklisted?.blacklisted === "boolean", "blacklisted.blacklisted");
  return problems;
}

export function validateDnsLeak(entries) {
  const problems = [];
  if (!Array.isArray(entries)) {
    return ["array of results"];
  }
  const result = analyzeDnsLeak(entries);
  missing(problems, result.servers.length > 0, 'entries with type "dns"');
  missing(problems, result.conclusion !== null, 'entry with type "conclusion"');
  return problems;
}

function verdict(problems, summary, data) {
  return problems.length
    ? { status: "fail", summary: t("selftestUnexpected", problems.join(", ")), raw: raw(data) }
    : { status: "pass", summary, raw: raw(data) };
}

async function jsonCheck(url, validate, describe, { fetchImpl }) {
  const data = await fetchJson(url, { fetchImpl });
  const problems = validate(data);
  return { data, result: verdict(problems, problems.length ? "" : describe(data), data) };
}

// Ordered so later checks can use the addresses found by earlier ones.
export function buildChecks({ fetchImpl = fetch } = {}) {
  const context = { ipv4: null, ipv6: null };
  const ipapiUrl = PROVIDERS[0].url;

  return [
    {
      id: "ipify4",
      name: "ipify (IPv4)",
      async run() {
        const { data, result } = await jsonCheck("https://api4.ipify.org/?format=json", validateIpify, (d) => d.ip, {
          fetchImpl
        });
        context.ipv4 = data.ip ?? null;
        return result;
      }
    },
    {
      id: "ipify6",
      name: "ipify (IPv6)",
      async run() {
        try {
          const { data, result } = await jsonCheck(
            "https://api6.ipify.org/?format=json",
            validateIpify,
            (d) => d.ip,
            { fetchImpl }
          );
          context.ipv6 = data.ip ?? null;
          return result;
        } catch (_error) {
          // No IPv6 route is normal and not a fault of the service.
          return { status: "info", summary: t("selftestNoIpv6"), raw: "" };
        }
      }
    },
    {
      id: "ipapi",
      name: "ipapi.is",
      run: async () =>
        (
          await jsonCheck(
            ipapiUrl(context.ipv4),
            validateIpapi,
            (d) => `${d.ip} · ${d.location.country_code} · AS${d.asn.asn} · is_vpn=${d.is_vpn}`,
            { fetchImpl }
          )
        ).result
    },
    {
      id: "ipwhois",
      name: "ipwho.is",
      run: async () =>
        (
          await jsonCheck(
            PROVIDERS[1].url(context.ipv4),
            validateIpwhois,
            (d) => `${d.ip} · ${d.country_code} · AS${d.connection.asn}`,
            { fetchImpl }
          )
        ).result
    },
    {
      id: "ipinfo",
      name: "ipinfo.io",
      run: async () =>
        (await jsonCheck(PROVIDERS[2].url(context.ipv4), validateIpinfo, (d) => `${d.ip} · ${d.country} · ${d.org}`, { fetchImpl }))
          .result
    },
    {
      id: "proxycheck",
      name: "proxycheck.io",
      async run() {
        const ip = context.ipv4 ?? context.ipv6;
        if (!ip) {
          return { status: "skip", summary: t("selftestNeedsIp"), raw: "" };
        }
        const data = await fetchJson(SECOND_OPINION.url(ip), { fetchImpl });
        const problems = validateProxycheck(data, ip);
        return verdict(problems, problems.length ? "" : `proxy=${SECOND_OPINION.normalize(data, ip).tunnelled ? "yes" : "no"}`, data);
      }
    },
    ...["IPv4", "IPv6"].map((family) => ({
      id: `mullvad${family}`,
      name: `am.i.mullvad.net (${family})`,
      async run() {
        if (family === "IPv6" && !context.ipv6) {
          return { status: "info", summary: t("selftestNoIpv6"), raw: "" };
        }
        const host = family === "IPv4" ? "ipv4" : "ipv6";
        return (
          await jsonCheck(
            `https://${host}.am.i.mullvad.net/json`,
            validateMullvad,
            (d) => `${d.ip} · mullvad_exit_ip=${d.mullvad_exit_ip}${d.mullvad_exit_ip_hostname ? ` (${d.mullvad_exit_ip_hostname})` : ""}`,
            { fetchImpl }
          )
        ).result;
      }
    })),
    {
      id: "dnsleak",
      name: "bash.ws (DNS leak test)",
      async run() {
        const result = await runDnsLeakTest({ fetchImpl });
        const problems = validateDnsLeak(result.entries);
        return verdict(problems, `${result.servers.length} DNS server(s) · ${result.conclusion}`, result.entries);
      }
    },
    {
      id: "webrtc",
      name: "WebRTC (STUN)",
      async run() {
        const lines = await gatherCandidates();
        const result = analyzeCandidates(lines, [context.ipv4, context.ipv6].filter(Boolean));
        return result.publicIps.length
          ? { status: "pass", summary: result.publicIps.join(", "), raw: raw(lines.join("\n")) }
          : { status: "info", summary: t("selftestNoStun"), raw: raw(lines.join("\n")) };
      }
    },
    {
      id: "helper",
      name: "BrowserIP helper + Mullvad CLI",
      async run() {
        if (!(await helperPermitted())) {
          return { status: "skip", summary: t("selftestHelperNotSetUp"), raw: "" };
        }
        const hello = await callHelper("hello");
        const status = await callHelper("status");
        const countries = await callHelper("countries").catch((error) => ({ error: error.message, countries: [] }));
        const problems = [];
        missing(problems, Boolean(hello.mullvad), "mullvad version");
        missing(problems, status.state !== "unknown", "status (unrecognized output)");
        missing(problems, countries.countries.length > 0, "relay list (no countries parsed)");
        const data = { hello, status, countryCount: countries.countries.length, countriesError: countries.error };
        return verdict(problems, `helper ${hello.helper} · Mullvad ${hello.mullvad} · ${status.state}${status.relay ? ` (${status.relay})` : ""} · ${countries.countries.length} countries`, data);
      }
    }
  ];
}

// Plain-text summary for bug reports.
export function formatResults(results, { version, userAgent }) {
  const icons = { pass: "PASS", fail: "FAIL", info: "INFO", skip: "SKIP" };
  const lines = [`BrowserIP ${version} self-test`, userAgent, ""];
  for (const result of results) {
    lines.push(`[${icons[result.status]}] ${result.name}: ${result.summary}`);
  }
  return lines.join("\n");
}
