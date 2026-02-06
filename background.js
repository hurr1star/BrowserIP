function iconSet(color) {
  return {
    16: `icons/icon-${color}-16.png`,
    32: `icons/icon-${color}-32.png`,
    48: `icons/icon-${color}-48.png`,
    128: `icons/icon-${color}-128.png`
  };
}

function setIconForVpn(vpnDetected) {
  const color = vpnDetected === true ? "green" : vpnDetected === false ? "red" : "gray";
  chrome.action.setIcon({ path: iconSet(color) });
}

chrome.runtime.onInstalled.addListener(() => {
  setIconForVpn(null);
});

chrome.runtime.onStartup.addListener(() => {
  setIconForVpn(null);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "vpnStatus") {
    return;
  }

  setIconForVpn(message.vpnDetected);
  sendResponse({ ok: true });
});
