// Protected sites: declarativeNetRequest rules that stop page loads on chosen
// domains while the VPN is not confirmed.
//
// With host permission for a site, the rule redirects to blocked.html, which
// explains why and continues once the VPN is back. Without it, Chrome cannot
// redirect, so the rule blocks the load outright. (A redirect rule that
// cannot apply would also shadow a lower-priority block rule, so each site
// gets exactly one of the two.)

const RESOURCE_TYPES = ["main_frame", "sub_frame"];

export function siteOrigins(domain) {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

export function buildGuardRules(sites, grantedSites, blockedPageUrl) {
  const granted = new Set(grantedSites);
  return sites.map((domain, index) =>
    granted.has(domain)
      ? {
          id: index + 1,
          priority: 1,
          action: { type: "redirect", redirect: { regexSubstitution: `${blockedPageUrl}#\\0` } },
          condition: { regexFilter: "^.*$", requestDomains: [domain], resourceTypes: RESOURCE_TYPES }
        }
      : {
          id: index + 1,
          priority: 1,
          action: { type: "block" },
          condition: { requestDomains: [domain], resourceTypes: RESOURCE_TYPES }
        }
  );
}

// Extracts the original URL from blocked.html's hash, accepting only web URLs.
// The hash holds the URL verbatim (including any "#fragment" of its own).
export function blockedTarget(hash) {
  try {
    const url = new URL(hash.replace(/^#/, ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch (_error) {
    return null;
  }
}
