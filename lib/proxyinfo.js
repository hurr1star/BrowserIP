import { t } from "./i18n.js";

function server(entry) {
  if (!entry?.host) {
    return null;
  }
  const scheme = entry.scheme ? `${entry.scheme}://` : "";
  return entry.port ? `${scheme}${entry.host}:${entry.port}` : `${scheme}${entry.host}`;
}

// Describes the browser's proxy configuration from chrome.proxy.settings.get()
// (Chrome's `mode` shape or Firefox's `proxyType` shape).
export function describeProxySettings(details) {
  const value = details?.value ?? {};
  let text;

  if (value.mode) {
    const rules = value.rules ?? {};
    switch (value.mode) {
      case "direct":
        text = t("proxyNone");
        break;
      case "system":
        text = t("proxySystem");
        break;
      case "auto_detect":
        text = t("proxyAutoDetect");
        break;
      case "pac_script":
        text = t("proxyPac", value.pacScript?.url || t("proxyInlinePac"));
        break;
      case "fixed_servers":
        text = t(
          "proxyFixed",
          server(rules.singleProxy) || server(rules.proxyForHttps) || server(rules.proxyForHttp) || "?"
        );
        break;
      default:
        text = value.mode;
    }
  } else {
    switch (value.proxyType) {
      case "none":
        text = t("proxyNone");
        break;
      case "system":
        text = t("proxySystem");
        break;
      case "autoDetect":
        text = t("proxyAutoDetect");
        break;
      case "autoConfig":
        text = t("proxyPac", value.autoConfigUrl || t("proxyInlinePac"));
        break;
      case "manual":
        text = t("proxyFixed", value.socks ? `socks${value.socksVersion ?? ""}://${value.socks}` : value.http || "?");
        break;
      default:
        text = value.proxyType || t("vpnUnknown");
    }
  }

  if (details?.levelOfControl === "controlled_by_other_extensions") {
    text += ` ${t("proxyByExtension")}`;
  }
  return text;
}
