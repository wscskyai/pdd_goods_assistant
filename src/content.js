/**
 * content script：后续用于识别/采集拼多多后台页面的商品信息编辑区域，
 * 并把结构化数据发送给 background / popup。
 */

// 仅在指定页面生效
if (location.origin !== "https://mms.pinduoduo.com" || !location.pathname.startsWith("/print/goods-setting")) {
  console.log("[PDD Goods Assistant] ignored page:", location.href);
} else {
  console.log("[PDD Goods Assistant] content script loaded:", location.href);

  const SETTINGS_KEY = "pdd_goods_assistant_settings";
  const UI_OPEN_BTN_ID = "pdd-ga-open-btn";
  const PANEL_ID = "pdd-ga-panel";
  const STYLE_ID = "pdd-ga-style";
  const SAVE_TIPS_ID = "pdd-ga-save-tips";
  const PANEL_ICON_URL = chrome.runtime.getURL("src/pdd.png");
  const LOG_MAX_LINES = 300;

  let runState = "idle"; // idle | running | paused | stopped
  let currentJob = null;
  const logBuffer = [];
  let logRenderPending = false;
  let runtimeCustomFilterTerms = [];

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function getSettings() {
    const data = await chrome.storage.local.get([SETTINGS_KEY]);
    return data?.[SETTINGS_KEY] ?? {};
  }

  async function setSettings(partial) {
    const current = await getSettings();
    const next = { ...current, ...partial };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{
        position: fixed;
        top: 80px;
        right: 16px;
        width: 432px;
        max-height: calc(100vh - 110px);
        overflow: auto;
        z-index: 2147483647;
        background: #fff;
        border: 1px solid rgba(0,0,0,.08);
        border-radius: 12px;
        box-shadow: 0 12px 34px rgba(0,0,0,.12);
        display: none;
      }
      #${PANEL_ID}[data-open="true"]{ display:block; }
      #${PANEL_ID} .pdd-ga-hd{
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding: 12px 14px;
        border-bottom: 1px solid rgba(255,255,255,.12);
        background: linear-gradient(135deg, #1b3a75 0%, #10264f 100%);
        color: #fff;
        cursor: move;
        user-select: none;
      }
      #${PANEL_ID} .pdd-ga-title-wrap{
        display:flex;
        align-items:center;
        gap: 10px;
      }
      #${PANEL_ID} .pdd-ga-title-icon{
        width: 18px;
        height: 18px;
        object-fit: contain;
        flex: 0 0 18px;
      }
      #${PANEL_ID} .pdd-ga-title{
        font-size: 15px;
        font-weight: 800;
        letter-spacing: .2px;
      }
      #${PANEL_ID} .pdd-ga-close{
        width: 22px;
        height: 22px;
        border: none;
        background: #ff4d4f;
        color: #fff;
        border-radius: 999px;
        padding: 0;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 2px 8px rgba(255,77,79,.35);
      }
      #${PANEL_ID} .pdd-ga-close:hover{
        background: #ff7875;
      }
      #${PANEL_ID} .pdd-ga-bd{ padding: 12px; }
      #${PANEL_ID} .pdd-ga-row{ margin-bottom: 10px; }
      #${PANEL_ID} .pdd-ga-row label{ display:block; font-size:12px; color:#666; margin-bottom:6px; }
      #${PANEL_ID} .pdd-ga-status{
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 10px;
        background: #f3f7ff;
        color: #1b3a75;
        font-size: 13px;
        font-weight: 600;
      }
      #${PANEL_ID} .pdd-ga-status-value{
        color: #1677ff;
        font-weight: 800;
      }
      #${PANEL_ID} .pdd-ga-status-row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap: 10px;
      }
      #${PANEL_ID} .pdd-ga-status-side{
        display:flex;
        justify-content:flex-end;
        flex: 1 1 auto;
      }
      #${PANEL_ID} .pdd-ga-row-compact{
        display: flex;
        gap: 10px;
      }
      #${PANEL_ID} .pdd-ga-field{
        flex: 1 1 0;
        min-width: 0;
      }
      #${PANEL_ID} .pdd-ga-field-sm{
        flex: 0 0 96px;
      }
      #${PANEL_ID} .pdd-ga-row input[type="number"],
      #${PANEL_ID} .pdd-ga-row input[type="text"],
      #${PANEL_ID} .pdd-ga-row select{
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid rgba(0,0,0,.12);
        border-radius: 10px;
        outline: none;
        background: #fff;
      }
      #${PANEL_ID} .pdd-ga-row .pdd-ga-inline{
        display:flex;
        align-items:center;
        gap: 8px;
      }
      #${PANEL_ID} .pdd-ga-row .pdd-ga-inline label{
        margin: 0;
        color: #333;
        font-size: 13px;
        display: inline-flex;
        align-items:center;
        gap: 6px;
      }
      #${PANEL_ID} .pdd-ga-subactions button{
        padding: 7px 10px;
        border-radius: 10px;
        border: 1px solid rgba(22,119,255,.22);
        background: #f3f7ff;
        color: #1677ff;
        cursor: pointer;
      }
      #${PANEL_ID} .pdd-ga-advanced{
        display:none;
        margin-bottom: 10px;
        border: 1px solid rgba(22,119,255,.12);
        background: #f8fbff;
        border-radius: 10px;
        padding: 10px;
      }
      #${PANEL_ID} .pdd-ga-advanced[data-open="true"]{
        display:block;
      }
      #${PANEL_ID} .pdd-ga-help{
        font-size: 12px;
        color: #666;
        line-height: 1.5;
        margin: 0 0 8px;
      }
      #${PANEL_ID} .pdd-ga-row textarea{
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid rgba(0,0,0,.12);
        border-radius: 10px;
        outline: none;
        background: #fff;
        resize: vertical;
        min-height: 110px;
        font: inherit;
      }
      #${PANEL_ID} .pdd-ga-advanced-actions{
        display:flex;
        justify-content:flex-end;
        gap: 8px;
        margin-top: 8px;
      }
      #${PANEL_ID} .pdd-ga-advanced-actions button{
        padding: 7px 12px;
        border-radius: 10px;
        border: 1px solid rgba(0,0,0,.12);
        background: #fff;
        cursor: pointer;
      }
      #${PANEL_ID} .pdd-ga-advanced-actions button[data-variant="primary"]{
        background: #1677ff;
        border-color: #1677ff;
        color: #fff;
      }
      #${PANEL_ID} .pdd-ga-actions{
        display:flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      #${PANEL_ID} .pdd-ga-actions button{
        flex: 1 1 auto;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(0,0,0,.12);
        background:#fff;
        cursor:pointer;
        min-width: 90px;
      }
      #${PANEL_ID} .pdd-ga-actions button[data-variant="primary"]{
        background: #1677ff;
        border-color: #1677ff;
        color: #fff;
      }
      #${PANEL_ID} .pdd-ga-actions button[data-variant="danger"]{
        background: #ff4d4f;
        border-color: #ff4d4f;
        color: #fff;
      }
      #${PANEL_ID} .pdd-ga-actions button:disabled{
        opacity:.55;
        cursor:not-allowed;
      }
      #${PANEL_ID} .pdd-ga-log{
        display: block;
        box-sizing: border-box;
        margin-top: 10px;
        background: #0b1020;
        color: #d5e1ff;
        font-size: 12px;
        border-radius: 10px;
        padding: 8px 10px;
        white-space: pre-wrap;
        min-height: 80px;
        max-height: 360px;
        overflow-y: auto;
        overflow-x: hidden;
      }
      #${SAVE_TIPS_ID}{
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: rgba(11, 16, 32, 0.92);
        color: #fff;
        padding: 10px 16px;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,.18);
        font-size: 14px;
        line-height: 1.2;
        display: none;
      }
      #${SAVE_TIPS_ID}[data-open="true"]{
        display: block;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureSaveTips() {
    if (document.getElementById(SAVE_TIPS_ID)) return;
    ensureStyle();
    const tips = document.createElement("div");
    tips.id = SAVE_TIPS_ID;
    tips.setAttribute("data-open", "false");
    tips.textContent = "正在保存数据...";
    document.documentElement.appendChild(tips);
  }

  function setSaveTipsOpen(open, text = "正在保存数据...") {
    ensureSaveTips();
    const tips = document.getElementById(SAVE_TIPS_ID);
    if (!tips) return;
    tips.textContent = text;
    tips.setAttribute("data-open", open ? "true" : "false");
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) return;
    ensureStyle();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute("data-open", "false");
    panel.innerHTML = `
      <div class="pdd-ga-hd">
        <div class="pdd-ga-title-wrap">
          <img class="pdd-ga-title-icon" src="${PANEL_ICON_URL}" alt="PDD" />
          <div class="pdd-ga-title">商品助理</div>
        </div>
        <button class="pdd-ga-close" type="button" data-act="close" data-no-drag="true" aria-label="关闭">✕</button>
      </div>
      <div class="pdd-ga-bd">
        <div class="pdd-ga-row pdd-ga-row-compact">
          <div class="pdd-ga-field pdd-ga-field-sm">
            <label for="pdd-ga-page-size">每页个数</label>
            <select id="pdd-ga-page-size">
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
          <div class="pdd-ga-field pdd-ga-field-sm">
            <label for="pdd-ga-scroll-speed">鼠标滚速</label>
            <select id="pdd-ga-scroll-speed">
              <option value="normal">普通</option>
              <option value="medium" selected>中速</option>
              <option value="fast">快速</option>
            </select>
          </div>
          <div class="pdd-ga-field">
            <label for="pdd-ga-save-delay">保存间隔[s]</label>
            <input id="pdd-ga-save-delay" type="number" min="0" step="1" value="2" />
          </div>
          <div class="pdd-ga-field">
            <label for="pdd-ga-delay">每条间隔[ms]</label>
            <input id="pdd-ga-delay" type="number" min="0" step="50" value="800" />
          </div>
        </div>
        <div class="pdd-ga-row">
          <div class="pdd-ga-inline">
            <label><input type="checkbox" id="pdd-ga-continuous" />自动翻页连续处理</label>
            <label><input type="checkbox" id="pdd-ga-skip-processed" />自动跳过已处理数据</label>
          </div>
        </div>
        <div class="pdd-ga-row">
          <div class="pdd-ga-status-row">
            <div class="pdd-ga-status">当前处理 <span class="pdd-ga-status-value" id="pdd-ga-current-page">-/-页</span></div>
            <div class="pdd-ga-status-side pdd-ga-subactions">
              <button type="button" data-act="toggle-custom-filter">自定义过滤词设置</button>
            </div>
          </div>
        </div>
        <div class="pdd-ga-advanced" id="pdd-ga-custom-filter-wrap" data-open="false">
          <div class="pdd-ga-help">一行一个过滤词。少于 2 个字会被忽略；与颜色、鞋子属性、尺码等必要关键字冲突的内容会自动忽略。保存后会自动更新为实际生效的过滤词。</div>
          <div class="pdd-ga-row">
            <textarea id="pdd-ga-custom-filter" placeholder="例如：&#10;店长力荐&#10;直播爆卖&#10;活动专享"></textarea>
          </div>
          <div class="pdd-ga-advanced-actions">
            <button type="button" data-act="cancel-custom-filter">取消</button>
            <button type="button" data-act="save-custom-filter" data-variant="primary">保存设置</button>
          </div>
        </div>

        <div class="pdd-ga-actions">
          <button type="button" data-act="start" data-variant="primary">开始处理</button>
          <button type="button" data-act="pause">暂停</button>
          <button type="button" data-act="stop" data-variant="danger">停止</button>
          <button type="button" data-act="clear-log">清日志</button>
        </div>

        <div class="pdd-ga-log" id="pdd-ga-log"></div>
      </div>
    `;

    panel.addEventListener("click", (e) => {
      const act = e?.target?.getAttribute?.("data-act");
      if (!act) return;
      if (act === "close") setPanelOpen(false);
      if (act === "start") onStart();
      if (act === "pause") onPause();
      if (act === "stop") onStop();
      if (act === "clear-log") clearLog();
      if (act === "toggle-custom-filter") toggleCustomFilterPanel();
      if (act === "cancel-custom-filter") closeCustomFilterPanel();
      if (act === "save-custom-filter") onSaveCustomFilter();
    });

    document.documentElement.appendChild(panel);
    enablePanelDrag();
    updateActionButtons();
    updateCurrentPageIndicator();
  }

  function setPanelOpen(open) {
    ensurePanel();
    const panel = document.getElementById(PANEL_ID);
    panel.setAttribute("data-open", open ? "true" : "false");
    if (open) updateCurrentPageIndicator();
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function enablePanelDrag() {
    const panel = document.getElementById(PANEL_ID);
    const handle = panel?.querySelector(".pdd-ga-hd");
    if (!panel || !handle || handle.dataset.dragBound === "true") return;
    handle.dataset.dragBound = "true";

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target?.closest?.('[data-no-drag="true"]')) return;

      const rect = panel.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";

      const onMove = (ev) => {
        const left = clamp(ev.clientX - offsetX, 0, Math.max(0, window.innerWidth - rect.width));
        const top = clamp(ev.clientY - offsetY, 0, Math.max(0, window.innerHeight - rect.height));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      e.preventDefault();
    });
  }

  function scheduleLogRender() {
    if (logRenderPending) return;
    logRenderPending = true;
    requestAnimationFrame(() => {
      logRenderPending = false;
      ensurePanel();
      const el = document.getElementById("pdd-ga-log");
      if (!el) return;
      // 固定上限，避免日志无限增长导致越来越卡
      el.textContent = logBuffer.join("\n");
    });
  }

  function logLine(line) {
    const now = new Date();
    const stamp = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(
      now.getSeconds()
    ).padStart(2, "0")}`;
    // 仍保持“最新在最上面”的体验
    logBuffer.unshift(`[${stamp}] ${line}`);
    if (logBuffer.length > LOG_MAX_LINES) logBuffer.length = LOG_MAX_LINES;
    scheduleLogRender();
  }

  function clearLog() {
    logBuffer.length = 0;
    scheduleLogRender();
  }

  function getCustomFilterTextarea() {
    return document.getElementById("pdd-ga-custom-filter");
  }

  function getCustomFilterWrap() {
    return document.getElementById("pdd-ga-custom-filter-wrap");
  }

  function setCustomFilterPanelOpen(open) {
    ensurePanel();
    const wrap = getCustomFilterWrap();
    if (!wrap) return;
    wrap.setAttribute("data-open", open ? "true" : "false");
  }

  function toggleCustomFilterPanel() {
    const wrap = getCustomFilterWrap();
    const isOpen = wrap?.getAttribute("data-open") === "true";
    setCustomFilterPanelOpen(!isOpen);
  }

  function closeCustomFilterPanel() {
    setCustomFilterPanelOpen(false);
  }

  function setCustomFilterTextareaValue(list) {
    const el = getCustomFilterTextarea();
    if (!el) return;
    el.value = Array.isArray(list) ? list.join("\n") : "";
  }

  function updateActionButtons() {
    ensurePanel();
    const startBtn = document.querySelector(`#${PANEL_ID} [data-act="start"]`);
    const pauseBtn = document.querySelector(`#${PANEL_ID} [data-act="pause"]`);
    const stopBtn = document.querySelector(`#${PANEL_ID} [data-act="stop"]`);
    if (startBtn) {
      startBtn.textContent = runState === "running" ? "处理中..." : runState === "paused" ? "继续处理" : "开始处理";
      startBtn.disabled = runState === "running";
    }
    if (pauseBtn) {
      pauseBtn.disabled = runState !== "running";
    }
    if (stopBtn) {
      stopBtn.disabled = runState !== "running" && runState !== "paused";
    }
  }

  function updateCurrentPageIndicator(pageNum = getActivePageNumber(), totalPageNum = getTotalPageNumber()) {
    ensurePanel();
    const el = document.getElementById("pdd-ga-current-page");
    if (!el) return;
    const current = Number.isFinite(pageNum) ? String(pageNum) : "-";
    const total = Number.isFinite(totalPageNum) ? String(totalPageNum) : "-";
    el.textContent = `${current}/${total}页`;
  }

  function findButtonByText(text) {
    const btns = Array.from(document.querySelectorAll('button[data-testid="beast-core-button"], button'));
    return btns.find((b) => (b?.innerText ?? "").trim().includes(text));
  }

  function injectOpenButton() {
    if (document.getElementById(UI_OPEN_BTN_ID)) return true;

    // 优先插到“更多”按钮后面（截图红框区域）
    const moreBtn = findButtonByText("更多");
    const templateBtn = findButtonByText("批量编辑信息") || findButtonByText("批量导入商品信息") || moreBtn;
    const anchor = moreBtn || templateBtn;
    if (!anchor || !anchor.parentElement) return false;

    const newBtn = templateBtn ? templateBtn.cloneNode(true) : document.createElement("button");
    newBtn.id = UI_OPEN_BTN_ID;
    newBtn.type = "button";

    // 清理原有内容（例如“更多”的 svg）
    newBtn.innerHTML = `<span>打开商品助理</span>`;
    newBtn.style.marginLeft = "10px";
    newBtn.style.background = "#1677ff";
    newBtn.style.borderColor = "#1677ff";
    newBtn.style.color = "#ffffff";
    newBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPanelOpen(true);
      logLine("已打开助理面板");
    });

    anchor.parentElement.insertBefore(newBtn, anchor.nextSibling);
    return true;
  }

  async function readPanelValues() {
    ensurePanel();
    const continuous = document.getElementById("pdd-ga-continuous")?.checked ?? false;
    const skipProcessed = document.getElementById("pdd-ga-skip-processed")?.checked ?? false;
    const pageSize = Number(document.getElementById("pdd-ga-page-size")?.value ?? 10);
    const scrollSpeedMode = document.getElementById("pdd-ga-scroll-speed")?.value ?? "medium";
    const saveDelaySec = Number(document.getElementById("pdd-ga-save-delay")?.value ?? 2);
    const delay = Number(document.getElementById("pdd-ga-delay")?.value ?? 0);
    const current = await getSettings();
    const settings = await setSettings({
      continuousProcess: continuous,
      skipProcessedData: skipProcessed,
      expectedPageSize: Number.isFinite(pageSize) ? pageSize : 10,
      scrollSpeedMode,
      saveDelaySec: Number.isFinite(saveDelaySec) ? saveDelaySec : 2,
      perItemDelayMs: Number.isFinite(delay) ? delay : 0,
      customFilterTerms: Array.isArray(current?.customFilterTerms) ? current.customFilterTerms : [],
      lastActiveAt: Date.now()
    });
    return settings;
  }

  async function hydratePanel() {
    ensurePanel();
    const settings = await getSettings();
    const continuous = !!settings?.continuousProcess;
    const pageSize = Number(settings?.expectedPageSize ?? 10);
    const scrollSpeedMode = settings?.scrollSpeedMode ?? "medium";
    const saveDelaySec = Number(settings?.saveDelaySec ?? settings?.perPageDelaySec ?? 2);
    const delay = Number(settings?.perItemDelayMs ?? 800);
    const skipProcessed = !!settings?.skipProcessedData;
    const customFilterTerms = Array.isArray(settings?.customFilterTerms) ? settings.customFilterTerms : [];

    const cEl = document.getElementById("pdd-ga-continuous");
    if (cEl) cEl.checked = continuous;
    const spEl = document.getElementById("pdd-ga-skip-processed");
    if (spEl) spEl.checked = skipProcessed;
    const sEl = document.getElementById("pdd-ga-page-size");
    if (sEl) sEl.value = String(Number.isFinite(pageSize) ? pageSize : 10);
    const ssEl = document.getElementById("pdd-ga-scroll-speed");
    if (ssEl) ssEl.value = String(scrollSpeedMode);
    const pEl = document.getElementById("pdd-ga-save-delay");
    if (pEl) pEl.value = String(Number.isFinite(saveDelaySec) ? saveDelaySec : 2);
    const dEl = document.getElementById("pdd-ga-delay");
    if (dEl) dEl.value = String(Number.isFinite(delay) ? delay : 800);
    setCustomFilterTextareaValue(customFilterTerms);
    runtimeCustomFilterTerms = customFilterTerms;
  }

  function getNextPageButton() {
    // 你提供的分页 HTML：下一页是 <li data-testid="beast-core-pagination-next" ...>
    const li = document.querySelector('li[data-testid="beast-core-pagination-next"]');
    if (li && isVisible(li)) {
      const cls = li.className ?? "";
      const disabled = cls.includes("PGT_disabled") || li.getAttribute("aria-disabled") === "true";
      if (!disabled) return li;
      return null;
    }

    // 兜底：部分页面可能有“下一页”文字按钮
    const candidates = Array.from(document.querySelectorAll("button, a")).filter((el) => {
      const t = (el?.innerText ?? "").trim();
      return t === "下一页" || t.includes("下一页");
    });
    const enabled = candidates.find((el) => {
      const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
      return !disabled;
    });
    return enabled ?? null;
  }

  function getActivePageNumber() {
    const ul = document.querySelector('ul[data-testid="beast-core-pagination"]');
    if (!ul) return null;
    const lis = Array.from(ul.querySelectorAll("li"));
    const active = lis.find((li) => (li.className ?? "").includes("PGT_pagerItemActive"));
    const n = Number.parseInt((active?.innerText ?? "").trim(), 10);
    return Number.isFinite(n) ? n : null;
  }

  function getTotalPageNumber() {
    const ul = document.querySelector('ul[data-testid="beast-core-pagination"]');
    if (!ul) return null;
    const lis = Array.from(ul.querySelectorAll("li"));
    const nums = lis
      .map((li) => Number.parseInt((li?.innerText ?? "").trim(), 10))
      .filter((n) => Number.isFinite(n));
    if (!nums.length) return null;
    return Math.max(...nums);
  }

  async function tryGoNextPage() {
    const next = getNextPageButton();
    if (!next) {
      logLine("未找到“下一页”按钮或已到最后一页，停止翻页");
      return false;
    }

    const beforePage = getActivePageNumber();
    const beforeFirstGoodsId = getGoodsIdFromRow(getGroupStartRows()[0] ?? null);

    singleClick(next.querySelector("svg") ?? next);
    logLine("已点击下一页，等待页面加载...");

    // 等待分页激活页变化 或 首个商品 ID 变化（最长 12 秒）
    for (let i = 0; i < 48; i++) {
      await sleep(250);
      const afterPage = getActivePageNumber();
      const afterFirstGoodsId = getGoodsIdFromRow(getGroupStartRows()[0] ?? null);
      if (
        (beforePage && afterPage && afterPage === beforePage + 1) ||
        (!beforePage && beforeFirstGoodsId && afterFirstGoodsId && afterFirstGoodsId !== beforeFirstGoodsId)
      ) {
        logLine(`翻页完成：${beforePage ?? "?"} -> ${afterPage ?? "?"}`);
        // 翻页后先把滚动条拉回顶部，避免列表异步渲染导致只加载到中间/底部
        await scrollListToTop();
        updateCurrentPageIndicator(afterPage);
        return true;
      }
    }

    logLine("翻页后未检测到页面变化（可能加载较慢或点击未生效）");
    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeText(s) {
    return String(s ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const SHOE_ATTR_WORDS = ["网面", "皮面", "革面", "加绒", "加棉", "加厚"];
  const SIZE_KEYWORDS = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL", "6XL", "均码", "内长", "码"];

  function normalizeBracketText(s) {
    return (
      String(s ?? "")
        // 保留括号内的词，只去掉括号本身：蓝色【网面】31 -> 蓝色网面31
        .replace(/[【\[]([^】\]]+)[】\]]/g, "$1")
        // 圆括号：如果包含鞋子关键属性，则保留内容；否则认为是补充说明/营销词，去掉
        .replace(/[\(（]([^\)）]*)[\)）]/g, (_m, inner) => {
          const txt = String(inner ?? "").trim();
          if (!txt) return "";
          const keep = SHOE_ATTR_WORDS.some((w) => txt.includes(w));
          return keep ? txt : "";
        })
    );
  }

  const KNOWN_COLORS = [
    "浅粉色",
    "深粉色",
    "粉色",
    "玫红色",
    "红色",
    "酒红色",
    "橙色",
    "黄色",
    "柠檬黄",
    "绿色",
    "墨绿色",
    "薄荷绿",
    "蓝色",
    "浅蓝色",
    "深蓝色",
    "藏蓝色",
    "天蓝色",
    "湖蓝色",
    "紫色",
    "浅紫色",
    "灰色",
    "深灰色",
    "银色",
    "黑色",
    "白色",
    "米色",
    "奶白色",
    "卡其色",
    "棕色",
    "咖啡色",
    "杏色",
    "金色"
  ];
  const PROTECTED_FILTER_TERMS = [...KNOWN_COLORS, ...SHOE_ATTR_WORDS, ...SIZE_KEYWORDS];

  const PROMO_SUFFIX_TRASH = [
    "六一活动专属",
    "高品质材料款",
    "舒适透气款",
    "传统材料款",
    "传统面料款",
    "优质面料款",
    "优质材料款",
    "金典面料款",
    "经典面料款",
    "精品材料款",
    "宝妈优选",
    "//升级版//",
    "店长推荐",
    "革新面料款",
    "精选材料款",
    "精选面料款",
    "臻选面料款",
    "普通面料款",
    "常规面料款",
    "甄选材料",
    "升级专柜版",
    "至臻面料",
    "臻选材料",
    "精选材料",
    "面料款",
    "精品面料",
    "精选面料",
    "专柜版",
    "更防滑耐磨",
    "百搭配裙",
    "传统",
    "材料款",
    "材质款",
    "经典款",
    "基础款",
    "百搭款",
    "时尚款",
    "潮流款",
    "精选款",
    "专业版",
    "旗舰版",
    "普通版",
    "豪华版",
    "升级版",
    "升级款",
    "新款",
    "爆款",
    "热卖款",
    "薄款",
    "普通款",
    "夏季",
    "臻品",
    "春秋",
    "秋冬",
    "童鞋",
    "儿童",
    "男童",
    "女童",
    "经典",
    "宝宝",
    "中大童"
  ];

  function sanitizeCustomFilterTerms(rawTextOrList) {
    const lines = Array.isArray(rawTextOrList) ? rawTextOrList : String(rawTextOrList ?? "").split(/\r?\n/);
    const normalized = [];
    for (const item of lines) {
      const term = normalizeText(item).replace(/^[,，;；、\-\s]+|[,，;；、\-\s]+$/g, "");
      if (!term) continue;
      if (term.length < 2) continue;

      const conflicts = PROTECTED_FILTER_TERMS.some((kw) => kw && (term.includes(kw) || kw.includes(term)));
      if (conflicts) continue;
      if (!normalized.includes(term)) normalized.push(term);
    }
    return normalized;
  }

  async function onSaveCustomFilter() {
    const el = getCustomFilterTextarea();
    const cleaned = sanitizeCustomFilterTerms(el?.value ?? "");
    await setSettings({ customFilterTerms: cleaned });
    setCustomFilterTextareaValue(cleaned);
    runtimeCustomFilterTerms = cleaned;
    closeCustomFilterPanel();
    logLine(`已保存自定义过滤词 ${cleaned.length} 条`);
  }

  /**
   * 输入示例："粉色网面 36" -> 输出："粉色，36码"
   * 尺码规则：
   * 1) 优先匹配类似 “34码”“32码内长19.5cm” 中的 “整数+码”
   * 2) 再兼容 “29内长约18.2cm” 这类没有“码”字、但后面直接跟“内长”的写法
   * 3) 再兼容服装尺码：S/M/L/XL/XXL/2XL/3XL/均码 等
   * 4) 若找不到，再兜底取结尾整数
   * 名称规则：
   * 1) 尽量保留颜色后的关键属性，如：网面/皮面/革面/加绒/加棉
   * 2) 清理明显促销或泛化后缀，如：升级版/新款/爆款/夏季
   */
  function extractColorAndSize(specNameLine) {
    const raw = normalizeText(normalizeBracketText(specNameLine));
    // 提前抓取鞋子属性词，防止后续清理时丢失（例如括号、分隔符等情况）
    const shoeAttrs = SHOE_ATTR_WORDS
      .map((w) => ({ w, idx: raw.indexOf(w) }))
      .filter((x) => x.idx >= 0)
      .sort((a, b) => a.idx - b.idx)
      .map((x) => x.w);

    // 取尺码：优先找 “整数 + 码”（兼容：绿色 34码内长20.5cm）
    const sizeWithMa = raw.match(/(\d{1,3})\s*码/);
    let size = "";
    let colorPart = raw;
    if (sizeWithMa?.[1]) {
      size = sizeWithMa[1];
      const idx = Number.isFinite(sizeWithMa.index) ? sizeWithMa.index : raw.indexOf(sizeWithMa[0]);
      if (idx >= 0) colorPart = normalizeText(raw.slice(0, idx));
    } else {
      // 兼容：米色 29内长约18.2cm
      const sizeBeforeInnerLength = raw.match(/(\d{1,3})\s*内长/);
      if (sizeBeforeInnerLength?.[1]) {
        size = sizeBeforeInnerLength[1];
        const idx = Number.isFinite(sizeBeforeInnerLength.index) ? sizeBeforeInnerLength.index : raw.indexOf(sizeBeforeInnerLength[0]);
        if (idx >= 0) colorPart = normalizeText(raw.slice(0, idx));
      } else {
        // 兼容服装尺码：白杏色 XL / 黑色 2XL / 米白 均码
        const alphaSizeMatch = raw.match(/(?:^|[\s/_-])((?:XS|S|M|L|XL|XXL|XXXL|XXXXL|2XL|3XL|4XL|5XL|6XL|均码|均\\s*码|F))(?:\s|$)/i);
        if (alphaSizeMatch?.[1]) {
          size = alphaSizeMatch[1].replace(/\s+/g, "").toUpperCase();
          if (size === "均码" || size === "均碼") size = "均码";
          const idx = Number.isFinite(alphaSizeMatch.index) ? alphaSizeMatch.index : raw.indexOf(alphaSizeMatch[0]);
          if (idx >= 0) colorPart = normalizeText(raw.slice(0, idx));
        } else {
          // 兜底：取结尾整数尺码
          const sizeMatch = raw.match(/(\d{1,3})(?:\s*(?:码|#|号))?\s*$/);
          size = sizeMatch?.[1] ?? "";
          if (size) colorPart = normalizeText(raw.replace(sizeMatch[0], ""));
        }
      }
    }

    // 清理促销文案，但保留鞋款属性（如网面/皮面/加绒）
    let cleaned = colorPart;
    // 自定义过滤词优先生效，避免被系统其它规则先改坏结构后无法正常匹配
    const customTerms = Array.isArray(currentJob?.settings?.customFilterTerms) ? currentJob.settings.customFilterTerms : runtimeCustomFilterTerms;
    for (const term of customTerms) {
      const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned.replace(new RegExp(safe, "g"), "");
    }
    // 清理类似 “-FS-” 这种前后带横杠的 2 字母标记
    // 注意：必须放在统一清理横杠之前，否则会被拆散成普通文本
    cleaned = cleaned.replace(/-[A-Za-z]{2}-/g, "");
    // 清理类似 “90宝妈选择 / 90%宝妈选择 / 81%宝妈选择 / \d%*选择” 这类营销片段
    cleaned = cleaned.replace(/[-—–_ ]*\d{1,3}%?[\u4e00-\u9fa5]{0,4}选择/g, "");
    // 清理少量残留的百分比营销尾巴
    cleaned = cleaned.replace(/[-—–_ ]*\d{1,3}%.*$/g, "");

    cleaned = cleaned.replace(/[-—–_]+/g, " ");
    cleaned = normalizeText(cleaned);

    for (let i = 0; i < 6; i++) {
      const before = cleaned;
      for (const w of PROMO_SUFFIX_TRASH) {
        cleaned = cleaned.replace(new RegExp(`${w}$`), "");
        cleaned = cleaned.replace(new RegExp(`${w}\\s*$`), "");
      }
      cleaned = normalizeText(cleaned);
      if (cleaned === before) break;
    }

    // 优先匹配 “XX色”
    let color = "";
    const colorWithSe = cleaned.match(/([\u4e00-\u9fa5]{1,6}色)/);
    if (colorWithSe?.[1]) color = colorWithSe[1];

    // 再匹配常见颜色表（取最长命中）
    if (!color) {
      let best = "";
      for (const c of KNOWN_COLORS) {
        if (cleaned.includes(c) && c.length > best.length) best = c;
      }
      color = best;
    }

    // 最后兜底：取开头 1~6 个中文
    if (!color) {
      const m = cleaned.match(/^[\u4e00-\u9fa5]{1,6}/);
      color = m?.[0] ?? cleaned;
    }

    // 最终简称优先保留 “颜色+属性”，例如：粉色网面 / 黑色加绒
    // 如果清理后不小心只剩颜色，这里把捕获到的鞋子属性补回去
    let shortBase = cleaned || color;
    if (shoeAttrs.length) {
      for (const a of shoeAttrs) {
        if (!shortBase.includes(a)) shortBase += a;
      }
    }
    // 最后一层兜底：把残留的分隔符和括号符号统一去掉
    shortBase = shortBase.replace(/[\/|【】]/g, " ");
    shortBase = normalizeText(shortBase);
    const isAlphaSize = /^(?:XS|S|M|L|XL|XXL|XXXL|XXXXL|2XL|3XL|4XL|5XL|6XL|均码)$/i.test(size);
    const shortName = size ? `${shortBase}，${size}${isAlphaSize ? "" : "码"}` : `${shortBase}`;
    return { color, size, shortName };
  }

  function setInputValue(input, value) {
    if (!input) return;
    input.focus();
    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
  }

  function getAllTableRows() {
    return Array.from(document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]'));
  }

  function getGroupStartRows() {
    return getAllTableRows().filter((tr) => tr.querySelector("td[rowspan]"));
  }

  function getVisibleGoodsIds() {
    const ids = [];
    for (const tr of getGroupStartRows()) {
      const id = getGoodsIdFromRow(tr);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  function getCurrentPageSize() {
    const panelValue = Number.parseInt((document.getElementById("pdd-ga-page-size")?.value ?? "").trim(), 10);
    if (Number.isFinite(panelValue)) return panelValue;
    const input = document.querySelector('input[data-testid="beast-core-select-htmlInput"]');
    const value = Number.parseInt((input?.value ?? "").trim(), 10);
    return Number.isFinite(value) ? value : null;
  }

  function singleClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {
      // ignore
    }
    try {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    } catch {
      // ignore
    }
    return true;
  }

  async function ensurePageSizeApplied(targetSize) {
    if (!targetSize) return true;
    const current = Number.parseInt((document.querySelector('input[data-testid="beast-core-select-htmlInput"]')?.value ?? "").trim(), 10);
    if (current === targetSize) return true;

    const header = document.querySelector('[data-testid="beast-core-select-header"]');
    if (!header) {
      logLine(`未找到页面分页大小选择器，继续按每页 ${targetSize} 条逻辑处理`);
      return false;
    }

    singleClick(header);
    await sleep(400);

    const candidates = Array.from(document.querySelectorAll("li,div,span"))
      .filter((el) => isVisible(el))
      .filter((el) => normalizeText(el.innerText) === String(targetSize));
    const option = candidates.find((el) => el.closest('[data-testid="beast-core-select"]') === null) ?? candidates[0] ?? null;

    if (!option) {
      logLine(`未找到每页 ${targetSize} 的选项，继续按每页 ${targetSize} 条逻辑处理`);
      return false;
    }

    singleClick(option);
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      const after = Number.parseInt((document.querySelector('input[data-testid="beast-core-select-htmlInput"]')?.value ?? "").trim(), 10);
      if (after === targetSize) {
        logLine(`已将页面每页条数设置为 ${targetSize}`);
        return true;
      }
    }

    logLine(`页面每页条数未确认切换成功，继续按每页 ${targetSize} 条逻辑处理`);
    return false;
  }

  function findScrollableAncestor(el) {
    let cur = el?.parentElement ?? null;
    while (cur && cur !== document.body) {
      const style = window.getComputedStyle(cur);
      const overflowY = style.overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && cur.scrollHeight > cur.clientHeight + 10) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  async function scrollListToTop() {
    // 翻页后该页面是异步加载，先把滚动条拉回顶部，有助于触发列表完整渲染
    const firstRow = getGroupStartRows()[0] ?? null;
    if (!firstRow) {
      window.scrollTo(0, 0);
      await sleep(200);
      return;
    }
    const scrollParent = findScrollableAncestor(firstRow);
    if (scrollParent) {
      scrollParent.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    await sleep(300);
  }

  async function sleepWhileRunning(ms) {
    let waited = 0;
    while (waited < ms) {
      if (runState !== "running") return false;
      const step = Math.min(120, ms - waited);
      await sleep(step);
      waited += step;
    }
    return runState === "running";
  }

  async function revealMoreGoodsInCurrentPage(job) {
    if (runState !== "running") return false;
    const beforeIds = getVisibleGoodsIds();
    const lastStartRow = getGroupStartRows().slice(-1)[0] ?? null;
    if (!lastStartRow) return false;

    const scrollParent = findScrollableAncestor(lastStartRow);
    const speedMode = job?.settings?.scrollSpeedMode ?? "medium";
    const speedMultiplier = speedMode === "normal" ? 0.75 : speedMode === "fast" ? 1.5 : 1;
    // 更像人工滚轮：连续小步下滚；到底后回顶部，再从上往下扫
    const stepBase = scrollParent
      ? Math.max(Math.floor(210 * speedMultiplier), Math.floor(scrollParent.clientHeight * 0.36 * speedMultiplier))
      : Math.floor(270 * speedMultiplier);
    const scroller = scrollParent ?? document.scrollingElement ?? document.documentElement;
    const maxScrollTop = Math.max(0, (scroller?.scrollHeight ?? 0) - (scroller?.clientHeight ?? window.innerHeight));
    const currentTop = scrollParent ? scrollParent.scrollTop : window.scrollY;
    const atBottom = currentTop >= maxScrollTop - 20;

    if (atBottom) {
      if (scrollParent) scrollParent.scrollTop = 0;
      else window.scrollTo(0, 0);
      logLine("当前页已滚到底部，已回到顶部继续扫描");
      const ok = await sleepWhileRunning(250);
      if (!ok) return false;
    }

    // 连续小步下滚，模拟人工滚轮
    const burstSteps = 5;
    for (let i = 0; i < burstSteps; i++) {
      if (runState !== "running") return false;

      if (scrollParent) {
        const nextTop = clamp(scrollParent.scrollTop + stepBase, 0, maxScrollTop);
        scrollParent.scrollTop = nextTop;
      } else {
        window.scrollTo(0, clamp(window.scrollY + stepBase, 0, maxScrollTop));
      }

      const ok = await sleepWhileRunning(140);
      if (!ok) return false;

      const afterIds = getVisibleGoodsIds();
      const hasNew = afterIds.some((id) => !beforeIds.includes(id) && !job.pageProcessedIds.has(id));
      if (hasNew) {
        logLine(`当前页加载出更多商品：可见 ${beforeIds.length} -> ${afterIds.length}（连续下滚触发）`);
        return true;
      }
    }

    return false;
  }

  function getGoodsIdFromRow(tr) {
    const txt = tr?.innerText ?? "";
    const m = txt.match(/ID[:：]\s*(\d+)/);
    return m?.[1] ?? "";
  }

  function getSpecNameFirstLine(specInfoEl) {
    const lines = String(specInfoEl?.innerText ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines[0] ?? "";
  }

  function findSpecInfoTdInRow(tr) {
    const tds = Array.from(tr.querySelectorAll("td"));
    return (
      tds.find((td) => {
        const t = td.innerText ?? "";
        return t.includes("规格ID") && t.includes("规格编码");
      }) ?? null
    );
  }

  function findShortNameInputInRow(tr) {
    // 你给的 HTML 里：规格简称输入框外层 div id 形如 "...-skuShortName"
    const direct =
      tr.querySelector('div[id$="-skuShortName"] input[data-testid="beast-core-input-htmlInput"]') ??
      tr.querySelector('div[id*="skuShortName"] input[data-testid="beast-core-input-htmlInput"]') ??
      tr.querySelector('div[id$="-skuShortName"] input') ??
      tr.querySelector('div[id*="skuShortName"] input');
    if (direct && isVisible(direct) && !direct.disabled) return direct;

    // 兜底：从规格信息 td 的后一个 td 找 input
    const specTd = findSpecInfoTdInRow(tr);
    const nextTd = specTd?.nextElementSibling ?? null;
    const fallback = nextTd?.querySelector?.('input[data-testid="beast-core-input-htmlInput"], input') ?? null;
    return fallback && isVisible(fallback) && !fallback.disabled ? fallback : null;
  }

  function findSaveAllChangesButton() {
    const buttons = Array.from(document.querySelectorAll('button[data-testid="beast-core-button"], button')).filter((el) =>
      isVisible(el)
    );
    return (
      buttons.find((btn) => {
        const t = (btn.innerText ?? "").trim();
        return t.includes("保存当前页所有修改") || t.includes("保存当前所有修改");
      }) ?? null
    );
  }

  function isProbablyClickable(el) {
    if (!el) return false;
    const tag = (el.tagName ?? "").toLowerCase();
    if (tag === "button" || tag === "a") return true;
    const role = (el.getAttribute?.("role") ?? "").toLowerCase();
    if (role === "button") return true;
    if (typeof el.onclick === "function") return true;
    const style = window.getComputedStyle(el);
    if (style.cursor === "pointer") return true;
    return false;
  }

  function safeClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {
      // ignore
    }
    const events = ["pointerdown", "pointerup", "mouseover", "mouseenter", "mousemove", "mousedown", "mouseup", "click"];
    for (const type of events) {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch {
        // ignore
      }
    }
    try {
      el.click?.();
    } catch {
      // ignore
    }
    return true;
  }

  function isExpandText(t) {
    const s = (t ?? "").trim();
    return s.includes("展开") && s.includes("规格");
  }

  function findClickableAncestor(el) {
    let cur = el;
    for (let i = 0; i < 6 && cur; i++) {
      if (isProbablyClickable(cur)) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  function getExpandKeyRoot(goodsId) {
    if (!goodsId) return null;
    return document.getElementById(`${goodsId}_expandKey`);
  }

  function isExpandedByExpandKey(goodsId) {
    const root = getExpandKeyRoot(goodsId);
    if (!root || !isVisible(root)) return false;
    const txt = normalizeText(root.innerText);
    return txt.includes("收起");
  }

  function getExpandKeyClickable(goodsId) {
    const root = getExpandKeyRoot(goodsId);
    if (!root || !isVisible(root)) return null;
    const direct =
      root.querySelector('a[data-testid="beast-core-button-link"]') ??
      root.querySelector("a") ??
      root.querySelector("button") ??
      root.querySelector("span") ??
      root;
    return findClickableAncestor(direct);
  }

  function getGroupExpansionSnapshot(group) {
    const goodsId = group.goodsId;
    if (!goodsId) {
      return {
        span: group.rows.length,
        specRows: group.rows.filter((tr) => (tr.innerText ?? "").includes("规格ID") && (tr.innerText ?? "").includes("规格编码")).length
      };
    }
    const idx = findStartIndexByGoodsId(goodsId);
    if (idx < 0) {
      return {
        span: group.rows.length,
        specRows: group.rows.filter((tr) => (tr.innerText ?? "").includes("规格ID") && (tr.innerText ?? "").includes("规格编码")).length
      };
    }
    const newGroup = getGroupRowsByStartIndex(idx);
    const newStartRow = getAllTableRows()[idx] ?? null;
    return {
      span: newStartRow ? calcRowspanFromStartRow(newStartRow) : newGroup.rows.length,
      specRows: newGroup.rows.filter((tr) => (tr.innerText ?? "").includes("规格ID") && (tr.innerText ?? "").includes("规格编码")).length
    };
  }

  function hasGroupExpanded(group, beforeSpan, beforeSpecRows) {
    if (group.goodsId && isExpandedByExpandKey(group.goodsId)) return true;
    const snap = getGroupExpansionSnapshot(group);
    return snap.span > beforeSpan || snap.specRows > beforeSpecRows;
  }

  function collectExpandCandidatesFromNode(node) {
    if (!node) return [];
    return Array.from(node.querySelectorAll("button,a,[role='button'],div,span"))
      .filter((el) => isVisible(el))
      .filter((el) => isExpandText(el.innerText));
  }

  function findExpandControlNearGroup(group) {
    // 优先使用稳定锚点：<商品ID>_expandKey
    if (group.goodsId) {
      const byId = getExpandKeyClickable(group.goodsId);
      if (byId) return byId;
    }

    const allRows = getAllTableRows();
    const startRow = allRows[group.startIndex] ?? null;
    const endRow = allRows[Math.min(group.startIndex + Math.max(group.rows.length - 1, 0), allRows.length - 1)] ?? startRow;
    if (!startRow) return null;

    const startRect = startRow.getBoundingClientRect();
    const endRect = (endRow ?? startRow).getBoundingClientRect();
    const groupTop = Math.min(startRect.top, endRect.top);
    const groupBottom = Math.max(startRect.bottom, endRect.bottom);

    // 优先只在“当前商品附近”找，避免全表多个展开控件时选错
    const localCandidates = [];
    for (const row of group.rows) {
      localCandidates.push(...collectExpandCandidatesFromNode(row));
    }
    let sib = endRow?.nextElementSibling ?? null;
    for (let i = 0; i < 3 && sib; i++) {
      localCandidates.push(...collectExpandCandidatesFromNode(sib));
      sib = sib.nextElementSibling;
    }

    const tableRoot = startRow.closest('[data-testid="beast-core-table"]') ?? document;
    const fallbackCandidates = collectExpandCandidatesFromNode(tableRoot);
    const candidates = [...new Set([...localCandidates, ...fallbackCandidates])];

    if (candidates.length === 0) return null;

    // 选一个最靠近该商品块底部的“展开规格”
    let best = null;
    let bestScore = Infinity;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      // 更偏好在该商品块垂直范围附近的：通常“展开全部规格(…)”在该商品块底部附近
      const within = r.top >= groupTop - 80 && r.top <= groupBottom + 220;
      const verticalDist = r.top >= groupBottom ? r.top - groupBottom : groupBottom - r.bottom;
      const score = (within ? 0 : 10000) + Math.abs(verticalDist) + Math.abs(r.left - startRect.left) / 20;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best ? findClickableAncestor(best) : null;
  }

  function calcRowspanFromStartRow(startRow) {
    const rowspans = Array.from(startRow.querySelectorAll("td[rowspan]"))
      .map((td) => Number(td.getAttribute("rowspan") ?? "1"))
      .filter((n) => Number.isFinite(n) && n > 0);
    return rowspans.length ? Math.max(...rowspans) : 1;
  }

  function getGroupRowsByStartIndex(startIndex) {
    const all = getAllTableRows();
    const startRow = all[startIndex];
    if (!startRow) return { startIndex, goodsId: "", rows: [] };
    const goodsId = getGoodsIdFromRow(startRow);
    const span = calcRowspanFromStartRow(startRow);
    return { startIndex, goodsId, rows: all.slice(startIndex, startIndex + span) };
  }

  function isSkippableSpecialGroup(group) {
    if (!group?.rows?.length) return false;
    // 这类补差价商品通常只有 1 个规格、无展开功能，且文案固定，但商品 ID 每店不同
    const text = normalizeText(group.rows.map((tr) => tr.innerText ?? "").join(" "));
    const isSingleRow = group.rows.length === 1;
    const hasSpecialName =
      text.includes("补收差价专用商品") || text.includes("补差价专用商品") || text.includes("联系客服确认");
    const hasDashCode = text.includes("商品编码：--") || text.includes("规格编码:--") || text.includes("规格编码：--");
    return isSingleRow && (hasSpecialName || hasDashCode);
  }

  function findStartIndexByGoodsId(goodsId) {
    if (!goodsId) return -1;
    const all = getAllTableRows();
    return all.findIndex((tr) => tr.querySelector("td[rowspan]") && getGoodsIdFromRow(tr) === goodsId);
  }

  async function ensureExpandedForGroup(group) {
    const { goodsId } = group;
    const allRows = getAllTableRows();
    const startRow = allRows[group.startIndex] ?? null;
    const beforeSpan = startRow ? calcRowspanFromStartRow(startRow) : group.rows.length;
    const beforeSpecRows = group.rows.filter((tr) => (tr.innerText ?? "").includes("规格ID") && (tr.innerText ?? "").includes("规格编码"))
      .length;

    if (goodsId && isExpandedByExpandKey(goodsId)) {
      logLine(`商品(ID=${goodsId || "-"})：已是展开状态（expandKey=收起）`);
      const idx = findStartIndexByGoodsId(goodsId);
      return idx >= 0 ? getGroupRowsByStartIndex(idx) : group;
    }

    const ctrl = findExpandControlNearGroup(group);
    if (!ctrl) {
      logLine(`商品(ID=${goodsId || "-"})：未找到“展开…规格”控件（可能在更外层，或文案不同）`);
      return group;
    }

    const t = (ctrl.innerText ?? "").trim();
    if (t.includes("收起")) return group;

    // 关键修复：
    // 不能把父级/自身/span/svg 全部连续点击，否则第一下展开、第二下又收起，表现成“不稳定”
    // 改为逐个尝试，只要检测到已展开就立刻停止
    const tryTargets = [
      findClickableAncestor(ctrl),
      ctrl,
      ctrl.querySelector?.("span") ?? null,
      ctrl.querySelector?.("svg") ?? null,
      ctrl.parentElement ?? null
    ].filter(Boolean);
    const orderedTargets = [...new Set(tryTargets)];
    logLine(`商品(ID=${goodsId || "-"})：准备展开规格（点击“${t}”）`);
    for (const target of orderedTargets) {
      safeClick(target);
      for (let i = 0; i < 8; i++) {
        await sleep(250);
        if (hasGroupExpanded(group, beforeSpan, beforeSpecRows)) {
          const idx = goodsId ? findStartIndexByGoodsId(goodsId) : group.startIndex;
          const newGroup = idx >= 0 ? getGroupRowsByStartIndex(idx) : group;
          const snap = getGroupExpansionSnapshot(newGroup);
          const byKey = goodsId && isExpandedByExpandKey(goodsId) ? "expandKey=收起" : "行数/规格行变化";
          logLine(
            `商品(ID=${goodsId || "-"})：展开成功（${byKey}；行数 ${beforeSpan} -> ${snap.span}，规格行 ${beforeSpecRows} -> ${snap.specRows}）`
          );
          return newGroup;
        }
      }
    }

    // 展开后可能会重新渲染 / rowspan 变化：用 goodsId 重新定位组
    if (goodsId) {
      const idx = findStartIndexByGoodsId(goodsId);
      if (idx >= 0) {
        const newGroup = getGroupRowsByStartIndex(idx);
        const newStartRow = getAllTableRows()[idx] ?? null;
        const afterSpan = newStartRow ? calcRowspanFromStartRow(newStartRow) : newGroup.rows.length;
        const afterSpecRows = newGroup.rows.filter(
          (tr) => (tr.innerText ?? "").includes("规格ID") && (tr.innerText ?? "").includes("规格编码")
        ).length;
        logLine(
          `商品(ID=${goodsId || "-"})：展开未确认（行数 ${beforeSpan} -> ${afterSpan}，规格行 ${beforeSpecRows} -> ${afterSpecRows}）。可能：控件不属于该商品/点击未生效/页面异步更慢。`
        );
        return newGroup;
      }
    }
    return group;
  }

  async function saveCurrentPageChanges() {
    if (runState !== "running") return false;
    const btn = findSaveAllChangesButton();
    if (!btn) {
      logLine("未找到“保存当前页所有修改”按钮");
      return false;
    }
    setSaveTipsOpen(true, "正在保存数据...");
    safeClick(btn);
    logLine("已点击“保存当前页所有修改”");
    const waitMs = Math.max(0, Number(currentJob?.settings?.saveDelaySec ?? 2) * 1000);
    let waited = 0;
    while (waited < waitMs) {
      if (runState !== "running") {
        setSaveTipsOpen(false);
        return false;
      }
      const step = Math.min(200, waitMs - waited);
      await sleep(step);
      waited += step;
    }
    setSaveTipsOpen(false);
    return true;
  }

  async function collapseGroupIfExpanded(goodsId) {
    if (runState !== "running") return false;
    if (!goodsId) return false;
    if (!isExpandedByExpandKey(goodsId)) return true;

    const root = getExpandKeyRoot(goodsId);
    const clickable =
      root?.querySelector('a[data-testid="beast-core-button-link"]') ??
      root?.querySelector("a") ??
      root?.querySelector("button") ??
      root;
    if (!clickable) return false;

    const t = normalizeText(clickable.innerText);
    if (!t.includes("收起")) return false;

    safeClick(findClickableAncestor(clickable));
    logLine(`商品(ID=${goodsId})：已点击“收起”`);

    for (let i = 0; i < 12; i++) {
      if (runState !== "running") return false;
      await sleep(200);
      if (!isExpandedByExpandKey(goodsId)) {
        logLine(`商品(ID=${goodsId})：已收起`);
        return true;
      }
    }

    logLine(`商品(ID=${goodsId})：收起未确认（可能页面异步更慢）`);
    return false;
  }

  async function processSingleGroup(group, settings, label) {
    const goodsId = group.goodsId || label;
    logLine(`开始处理${label}（ID=${goodsId || "-"}）`);

    const specRows = group.rows.filter((tr) => {
      const t = tr.innerText ?? "";
      return t.includes("规格ID") && t.includes("规格编码");
    });

    if (specRows.length === 0) {
      logLine(`${label}：未找到规格行`);
      return { processed: 0, modified: 0 };
    }

    const rowPlans = specRows.map((tr, index) => {
      const specTd = findSpecInfoTdInRow(tr);
      const specName = getSpecNameFirstLine(specTd);
      const input = findShortNameInputInRow(tr);
      const { shortName } = extractColorAndSize(specName);
      const currentValue = normalizeText(input?.value ?? "");
      const alreadyDone = !!input && currentValue === shortName;
      return { tr, index, specName, input, shortName, currentValue, alreadyDone };
    });

    if (settings.skipProcessedData && rowPlans.every((row) => row.input && row.alreadyDone)) {
      logLine(`${label}：检测到所有规格简称都已填写，自动跳过`);
      return { processed: 0, skipped: rowPlans.length, modified: 0 };
    }

    let processed = 0;
    let modified = 0;
    for (let i = 0; i < rowPlans.length; i++) {
      if (runState !== "running") return { processed, modified };

      const row = rowPlans[i];
      const { specName, shortName, input } = row;

      if (!specName) {
        logLine(`${label} 规格第 ${i + 1} 行：未识别到规格名称（跳过）`);
      } else if (!input) {
        logLine(`${label} 规格第 ${i + 1} 行：未找到“规格简称”输入框（跳过）`);
      } else if (settings.skipProcessedData && row.alreadyDone) {
        logLine(`${label} 规格第 ${i + 1} 行：已是目标值（跳过）`);
      } else {
        setInputValue(input, shortName);
        logLine(`${label} 规格第 ${i + 1} 行：${specName} -> ${shortName}`);
        modified += 1;
      }

      processed += 1;
      await sleep(settings.perItemDelayMs);
    }

    return { processed, modified };
  }

  async function processSpecRows(job) {
    const { settings } = job;

    while (runState === "running") {
      // 逐商品处理（当前页）：动态扫描当前页未处理商品，不再依赖首次 DOM 快照
      if (!job.pageProcessedIds) job.pageProcessedIds = new Set();
      if (typeof job.noNewGoodsRounds !== "number") job.noNewGoodsRounds = 0;

      // 每次开始处理当前页前，先把滚动条拉回顶部（该页面翻页后为异步加载）
      await scrollListToTop();
      updateCurrentPageIndicator();

      const pageSize = Number(settings.expectedPageSize ?? getCurrentPageSize() ?? 10);
      logLine(`开始扫描当前页商品（每页=${pageSize ?? "?"}，已处理=${job.pageProcessedIds.size}）`);

      while (runState === "running") {
        const visibleIds = getVisibleGoodsIds();
        if (visibleIds.length === 0) {
          logLine("未找到商品表格行（可能页面未加载完成）");
          runState = "idle";
          updateActionButtons();
          currentJob = null;
          return;
        }

        const targetGoodsId = visibleIds.find((id) => !job.pageProcessedIds.has(id));
        if (!targetGoodsId) {
          // 当前可见商品都处理完了，尝试滚动加载更多同页商品
          const revealed = await revealMoreGoodsInCurrentPage(job);
          if (revealed) {
            job.noNewGoodsRounds = 0;
            continue;
          }

          const hasNext = !!getNextPageButton();
          if (hasNext && pageSize && job.pageProcessedIds.size < pageSize) {
            job.noNewGoodsRounds = 0;
            logLine(`当前页尚未达到设定数量 ${job.pageProcessedIds.size}/${pageSize}，继续尝试加载剩余商品...`);
            await sleep(800);
            continue;
          }

          job.noNewGoodsRounds += 1;
          // 连续 2 轮都没有新商品，才认定当前页已处理完
          if (job.noNewGoodsRounds < 2) {
            logLine("当前页暂未发现新商品，再次尝试扫描...");
            await sleep(500);
            continue;
          }

          logLine(`当前页商品已处理完成（已处理=${job.pageProcessedIds.size}${pageSize ? `/${pageSize}` : ""}）`);
          break;
        }

        job.noNewGoodsRounds = 0;
        let startIndex = findStartIndexByGoodsId(targetGoodsId);
        if (startIndex < 0) {
          // 页面可能在刷新/虚拟渲染，先尝试滚动再重试，不直接跳过
          await revealMoreGoodsInCurrentPage(job);
          await sleep(300);
          startIndex = findStartIndexByGoodsId(targetGoodsId);
        }
        if (startIndex < 0) {
          logLine(`商品(ID=${targetGoodsId})：未能重新定位到行，本轮先跳过，稍后重试`);
          continue;
        }

        let group = getGroupRowsByStartIndex(startIndex);
        if (isSkippableSpecialGroup(group)) {
          logLine(`商品(ID=${targetGoodsId})：识别为补差价/特殊单规格商品，自动跳过并计为完成`);
          job.pageProcessedIds.add(targetGoodsId);
          await sleep(150);
          continue;
        }
        group = await ensureExpandedForGroup(group);
        const result = await processSingleGroup(group, settings, `商品 ${job.pageProcessedIds.size + 1}`);
        job.processedCount += result.processed;
        if (runState !== "running") return;

        // 只有本商品组确实发生了修改，才点击保存，避免无修改时反复保存
        if ((result?.modified ?? 0) > 0) {
          await saveCurrentPageChanges();
          if (runState !== "running") return;
        } else {
          logLine(`商品(ID=${targetGoodsId})：本轮无实际修改，跳过保存`);
        }
        // 临时停用“处理后自动收起”，避免页面高度变化影响后续商品识别
        // await collapseGroupIfExpanded(group.goodsId);
        // if (runState !== "running") return;

        job.pageProcessedIds.add(targetGoodsId);
        await sleep(200);
      }

      if (runState !== "running") return;

      // 当前页结束，按需翻页
      if (!settings.continuousProcess) {
        runState = "idle";
        updateActionButtons();
        currentJob = null;
        logLine("当页处理完成（未开启连续处理）");
        return;
      }

      if (runState !== "running") return;
      const ok = await tryGoNextPage();
      if (!ok) {
        runState = "idle";
        updateActionButtons();
        currentJob = null;
        return;
      }

      // 等待翻页加载后继续处理下一页
      await sleep(1200);
      job.pageProcessedIds = new Set();
      job.noNewGoodsRounds = 0;
      job.processedCount = 0;
    }
  }

  async function onStart() {
    if (runState === "running") {
      logLine("已在运行中");
      return;
    }

    if (runState === "paused" && currentJob) {
      runState = "running";
      updateActionButtons();
      logLine("继续处理：保留当前进度，从当前位置继续");
      await processSpecRows(currentJob);
      updateActionButtons();
      return;
    }

    const settings = await readPanelValues();
    runState = "running";
    updateActionButtons();
    updateCurrentPageIndicator();
    await ensurePageSizeApplied(settings.expectedPageSize);
    currentJob = {
      startedAt: Date.now(),
      settings,
      pageProcessedIds: new Set(),
      noNewGoodsRounds: 0,
      processedCount: 0
    };
    logLine("开始处理：提取“规格信息”首行 -> 写入“规格简称”");
    await processSpecRows(currentJob);
    updateActionButtons();
  }

  function onPause() {
    if (runState !== "running") {
      logLine("当前不在处理中，无法暂停");
      return;
    }
    runState = "paused";
    updateActionButtons();
    logLine("已暂停自动处理与自动滚动，可手动滚动页面；点“继续处理”可接着执行");
  }

  function onStop() {
    if (runState === "idle") {
      logLine("当前未运行");
      return;
    }
    runState = "stopped";
    updateActionButtons();
    currentJob = null;
    logLine("已停止");
  }

  // 初始 PING：确认 background 正常
  chrome.runtime.sendMessage({ type: "PING" }, (resp) => {
    if (chrome.runtime.lastError) return;
    console.log("[PDD Goods Assistant] PING resp:", resp);
  });

  // 注入按钮 + 面板（React 页面异步渲染，使用 observer 兜底）
  ensurePanel();
  hydratePanel();
  injectOpenButton();
  const mo = new MutationObserver(() => {
    injectOpenButton();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}
