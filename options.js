import { loadSettings, saveSettings } from "./lib/settings.js";

const form = document.getElementById("settings");
const savedEl = document.getElementById("saved");

function readForm() {
  return {
    expectVpn: form.elements.expectVpn.checked,
    pollMinutes: Number(form.elements.pollMinutes.value),
    notifyOnChange: form.elements.notifyOnChange.checked,
    showCountryBadge: form.elements.showCountryBadge.checked,
    checkIpv6: form.elements.checkIpv6.checked
  };
}

function fillForm(settings) {
  form.elements.expectVpn.checked = settings.expectVpn;
  form.elements.pollMinutes.value = String(settings.pollMinutes);
  form.elements.notifyOnChange.checked = settings.notifyOnChange;
  form.elements.showCountryBadge.checked = settings.showCountryBadge;
  form.elements.checkIpv6.checked = settings.checkIpv6;
}

form.addEventListener("change", async () => {
  try {
    await saveSettings(readForm());
    savedEl.textContent = "Saved.";
  } catch (error) {
    savedEl.textContent = `Could not save: ${error.message}`;
  }
});

loadSettings().then(fillForm);
