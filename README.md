# pdd_goods_assistant

一个 Google Chrome 浏览器插件：用于辅助管理拼多多商品信息编辑与发货流程（项目基础脚手架）。

## 目录结构

- `manifest.json`：Chrome Extension Manifest v3
- `src/background.js`：Service Worker（后台）
- `src/content.js`：Content Script（注入到拼多多页面）
- `src/popup/`：插件弹窗 UI
- `src/options/`：插件设置页
- `src/shared/storage.js`：基于 `chrome.storage.local` 的配置读写

## 本地加载（开发）

1. 打开 Chrome，进入 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录（包含 `manifest.json`）

## 下一步建议

- 明确拼多多后台使用的域名与页面路径（商品编辑页/发货页）
- 在 `content.js` 中识别关键表单字段并抽取/回填数据
- 用 `chrome.scripting` 在当前 Tab 执行更复杂的 DOM 操作

