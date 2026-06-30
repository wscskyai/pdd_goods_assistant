/**
 * content script：后续用于识别/采集拼多多后台页面的商品信息编辑区域，
 * 并把结构化数据发送给 background / popup。
 */

// 保险起见：即使未来 matches 放宽，这里也做一次路径判断
if (location.origin !== "https://mms.pinduoduo.com" || !location.pathname.startsWith("/print/goods-setting")) {
  // eslint-disable-next-line no-console
  console.log("[PDD Goods Assistant] ignored page:", location.href);
} else {
  // eslint-disable-next-line no-console
  console.log("[PDD Goods Assistant] content script loaded:", location.href);

  chrome.runtime.sendMessage({ type: "PING" }, (resp) => {
    // 在控制台看到响应，说明 background 正常工作
    if (chrome.runtime.lastError) return;
    // eslint-disable-next-line no-console
    console.log("[PDD Goods Assistant] PING resp:", resp);
  });
}
