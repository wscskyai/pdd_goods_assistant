const SETTINGS_KEY = "pdd_goods_assistant_settings";

export async function getSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY]);
  return data?.[SETTINGS_KEY] ?? {};
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

