import { getSettings, setSettings } from "../shared/storage.js";

const input = document.getElementById("pddDomainHint");
const hint = document.getElementById("hint");
const btnSave = document.getElementById("btnSave");

async function load() {
  const settings = await getSettings();
  input.value = settings?.pddDomainHint ?? "pinduoduo.com";
}

btnSave.addEventListener("click", async () => {
  const value = input.value.trim();
  await setSettings({ pddDomainHint: value, lastActiveAt: Date.now() });
  hint.textContent = `已保存：${new Date().toLocaleString()}`;
});

load();

