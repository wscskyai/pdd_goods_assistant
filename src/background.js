import { getSettings, setSettings } from "./shared/storage.js";

chrome.runtime.onInstalled.addListener(async () => {
  // 首次安装时写入默认配置
  const settings = await getSettings();
  if (!settings || Object.keys(settings).length === 0) {
    await setSettings({
      pddDomainHint: "pinduoduo.com",
      lastActiveAt: Date.now()
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({
      ok: true,
      from: "background",
      tabId: sender?.tab?.id ?? null,
      time: Date.now()
    });
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  return false;
});

