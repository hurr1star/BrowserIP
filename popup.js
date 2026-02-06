const ipEl = document.getElementById("ip");
const statusEl = document.getElementById("status");
const refreshButton = document.getElementById("refresh");
const locationEl = document.getElementById("location");
const countryEl = document.getElementById("country");
const providerEl = document.getElementById("provider");
const vpnStatusEl = document.getElementById("vpnStatus");
const vpnWarningEl = document.getElementById("vpnWarning");

function reportVpnStatus(vpnDetected) {
  try {
    chrome.runtime.sendMessage({ type: "vpnStatus", vpnDetected }, () => {
      // Ignore "Receiving end does not exist" so popup UI keeps working.
      void chrome.runtime.lastError;
    });
  } catch (_error) {
    // Ignore messaging errors from transient background worker lifecycle.
  }
}

function setUnavailable() {
  ipEl.textContent = "Unavailable";
  locationEl.textContent = "Unavailable";
  countryEl.textContent = "Unavailable";
  providerEl.textContent = "Unavailable";
  vpnStatusEl.textContent = "Unavailable";
  vpnWarningEl.hidden = true;
  reportVpnStatus(null);
}

async function loadIp() {
  refreshButton.disabled = true;
  statusEl.textContent = "Fetching network details...";

  try {
    const response = await fetch("https://api.ipapi.is/", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();

    const locationParts = [data.location?.city, data.location?.state].filter(Boolean);
    const provider = data.company?.name || data.asn?.org;
    const vpnDetected = data.is_vpn;

    ipEl.textContent = data.ip || "Unavailable";
    locationEl.textContent = locationParts.length ? locationParts.join(", ") : "Unavailable";
    countryEl.textContent = data.location?.country || "Unavailable";
    providerEl.textContent = provider || "Unavailable";
    if (vpnDetected === true) {
      vpnStatusEl.textContent = "Detected";
      vpnWarningEl.hidden = true;
      reportVpnStatus(true);
    } else if (vpnDetected === false) {
      vpnStatusEl.textContent = "Not detected";
      vpnWarningEl.hidden = false;
      reportVpnStatus(false);
    } else {
      vpnStatusEl.textContent = "Unknown";
      vpnWarningEl.hidden = true;
      reportVpnStatus(null);
    }
    statusEl.textContent = "Updated successfully.";
  } catch (error) {
    setUnavailable();
    statusEl.textContent = `Could not load IP: ${error.message}`;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadIp);
loadIp();
