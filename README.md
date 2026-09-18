# SOP Forge

SOP Forge 是一個 local-first 的瀏覽器操作錄製工具。使用者在獨立的 Playwright Chromium 視窗中手動操作網站，工具會保存事件、截圖與可編輯步驟，並輸出 HTML 或 PDF。

## 架構總覽

SOP Forge 在開發時由兩個程序組成：

| 程序 | Port | 職責 |
| --- | ---: | --- |
| Vite + React web app | `5173` | 顯示操作介面、開始/停止錄製、編輯步驟 |
| Fastify API + WebSocket | `3001` | 啟動 Playwright、接收錄製事件、保存 SQLite/截圖、產生 HTML/PDF |

瀏覽器開啟的是 Vite 頁面。Vite 會把 `/api/*` 和 `/ws/*` 代理到 Fastify，因此一般使用時前後端都必須啟動。

## 環境需求

- Node.js 20 或更新版本
- npm
- 可以啟動 Chromium 的本機環境

## 安裝

在專案根目錄執行：

```bash
npm install
npm run playwright:install
```

`playwright:install` 只需要在第一次使用，或 Playwright/瀏覽器版本更新後重新執行。

## 啟動方式

### 一次啟動前後端

最簡單的開發方式：

```bash
npm run dev
```

這個指令會使用 `concurrently` 同時啟動：

- 前端：<http://localhost:5173>
- 後端 health check：<http://127.0.0.1:3001/api/health>

看到兩個程序都保持執行後，再開啟 <http://localhost:5173>。

### 分開啟動前端與後端

如果需要分別查看 log，開兩個 terminal，都位於專案根目錄。

Terminal 1，啟動後端：

```bash
npm run dev:server
```

Terminal 2，啟動前端：

```bash
npm run dev:web
```

停止時，分別在兩個 terminal 按 `Ctrl+C`。`npm run dev` 則會在其中一個程序停止時一併停止另一個程序。

### 設定 Port 與資料目錄

後端會讀取 process environment；可以先複製設定範例，再由目前的 shell 載入：

```bash
cp .env.example .env
set -a
source .env
set +a
npm run dev
```

也可以不建立 `.env`，直接在啟動指令前指定環境變數，例如 `PORT=3002 npm run dev:server`。目前專案沒有自動載入 `.env` 的 dotenv 套件，因此只建立檔案而沒有 `source .env` 不會改變 server 設定。

可用設定：

```dotenv
HOST=127.0.0.1
PORT=3001
DATA_DIR=.sop-forge
```

目前 server 直接讀取 `HOST`、`PORT`、`DATA_DIR`。Vite 前端固定使用 `5173`，而且開發代理預設指向 `http://localhost:3001`；如果更改後端 port，也要同步調整 `vite.config.ts` 的 proxy。

資料預設寫入 `.sop-forge/`，包含 SQLite database、截圖與輸出的 PDF。這個目錄已加入 `.gitignore`，不應提交到 git。

## 錄製流程

1. 開啟 <http://localhost:5173>。
2. 輸入 `http://` 或 `https://` 起始網址。
3. 按下 `Start recording`。
4. 在新開的 Playwright Chromium 視窗中操作目標網站。
5. 回到 SOP Forge，按下 `Stop and save session`。
6. 編輯步驟文字、順序或截圖標註。
7. 在主頁使用 `Preview/edit HTML` 開啟獨立 HTML 預覽/編輯頁，或使用 `Export PDF` 匯出文件。

主頁的 Live Preview 是唯讀畫面，不提供步驟文字或 annotation 編輯。所有編輯都在 `Preview/edit HTML` 頁面執行；`/api/projects/:projectId/preview` 是唯讀 HTML，`/api/projects/:projectId/edit` 是可編輯 HTML。

在編輯頁可以用 circle、rectangle、arrow、text 工具標註截圖。選取物件後可移動、縮放、旋轉或刪除，也可以調整顏色、undo/redo、縮放圖片，以及下載合併 annotation 後的 PNG。這些 annotation 會保存到 project，並在 `Export PDF` 產出的 PDF 中顯示。

編輯資料目前同時支援 legacy `annotations` 與 versioned `editorDocument`。新的 document 使用相對於原始截圖的 normalized 座標，包含非破壞性的 crop、90 度旋轉、水平/垂直翻轉、樣式與 line/path/callout/marker/redaction 物件；既有四種 annotation 不需要先轉檔。純 geometry、command history、migration 與 static SVG renderer 位於 `packages/renderer/src/editor-core.ts` 和 `packages/renderer/src/editor-svg.ts`，唯讀 HTML/PDF 會排除 selection UI。pixelate redaction 在沒有 raster filter 的輸出路徑採 solid fallback，原始 screenshot asset 不會被覆寫。

目前會捕捉 navigation、click、input、select，以及 Enter、Tab、Escape 鍵。密碼欄位只保存 `[REDACTED]`，不保存原始值。click 的截圖會在 click-time 優先保存，避免點擊後立即 navigation 導致截到下一頁。

## 不按 Stop and save session 會怎樣？

`Stop and save session` 是正常結束錄製的必要步驟。它會：

1. 等待尚未處理完成的事件與截圖寫入 storage。
2. 關閉 Playwright 錄製瀏覽器。
3. 將 session 與 project 狀態更新為 `completed`。
4. 將完整 project 回傳給前端，讓預覽和 PDF 可以使用。

如果不按 Stop：

- Playwright 瀏覽器通常會繼續開著，server 也會繼續持有這個 active session。
- 已經處理完成的事件可能已經寫入資料庫，但最後幾個事件不保證已 flush 完成。
- project 仍可能停留在 `recording` 狀態，不能視為一份正常完成的 SOP。
- 前端重新整理或關閉時，WebSocket 只會斷開 UI 連線；後端錄製不會因此自動停止。重新開啟 UI 目前也沒有「接回既有 active session」的功能。
- 如果直接關閉錄製用的 Chromium，系統會嘗試把 session 標記為 `interrupted`，但這不是等同於正常 Stop，最後資料仍可能不完整。
- 如果直接終止 server，記憶體中的 active session manager 會消失，SQLite 裡可能留下 `recording` 狀態；這種情況應重新開始一個錄製 session。

因此建議每次錄製完成後都按 Stop，確認 UI 顯示 `Recording complete` 後再關閉 browser 或 terminal。

## 後端沒有啟動時可以做什麼？

如果只有 Vite 在 `5173` 執行，React 頁面本身可能仍然可以開啟，但它無法完成真正的 SOP 製作：

- `POST /api/sessions` 無法建立錄製 session。
- Playwright Chromium 不會被啟動，也不會收到錄製事件。
- WebSocket `/ws/:sessionId` 無法提供即時步驟更新。
- project、SQLite、截圖與 annotation 無法讀取或保存。
- HTML preview 與 PDF export 也無法正常使用。

先檢查後端：

```bash
curl http://127.0.0.1:3001/api/health
```

正常應回傳：

```json
{"status":"ok"}
```

如果回傳 connection refused，請在另一個 terminal 執行 `npm run dev:server`，再重新整理前端頁面。完整使用情境需要前端和後端都保持執行；它們不是永久常駐服務，terminal/process 結束後就會停止。

## React 與純 HTML/JavaScript 的關係

可以把適合的部分改成 React，而且目前 SOP Forge 的主要操作介面本來就是 React，入口在 `apps/web/src/main.tsx`。

但畫面中看到的所有 HTML/JavaScript 都不適合一律改成 React，因為它們屬於不同執行環境：

### 1. SOP Forge 操作介面：適合使用 React

這是自己的 web app，擁有 React root、Vite、React state 和 TypeScript。開始錄製、狀態顯示、步驟編輯與 preview 入口都適合放在 React component 中。

### 2. `playwright-adapter.ts` 的 instrumentation：應維持獨立 JavaScript

圖中 `const instrumentation = String.raw\`...\`` 的內容不是 SOP Forge 自己的 React 頁面，而是由 Playwright 注入「使用者正在錄製的任意外部網站」。它必須：

- 不依賴目標網站有 React root。
- 在任意網站載入時都能執行。
- 以最小成本監聽 click、input、select 和 keypress。
- 避免把 React runtime 注入每一個被錄製的網站。

所以這段保留為 plain browser JavaScript 是正確的設計，不代表整個專案不是 React。若硬改成 React，反而會增加注入 bundle、相依版本、CSP 和初始化時機問題。

### 3. HTML preview/PDF renderer：可以 React 化，但不一定值得

preview 目前要產生可單獨開啟的 HTML，PDF 也需要由 Playwright 載入這份 HTML。這種輸出使用純 HTML、SVG 和 inline JavaScript 有幾個優點：

- 不需要依賴外部 CDN。
- 產出的檔案容易保存與分享。
- PDF renderer 不需要額外處理 hydration。
- annotation SVG 在 standalone preview 中可以直接運作。

如果改成 React，合理做法是使用 React SSR，再另外提供 client bundle 進行 hydration；這可行，但需要處理 bundle 路徑、輸出檔案攜帶 JavaScript、SSR/瀏覽器狀態同步，以及 PDF 載入等待。對目前的 local-first standalone preview 而言，收益不一定大於複雜度。

### 建議的分層

- **保留 React**：SOP Forge 主介面與未來更大型的編輯器。
- **保留 plain JavaScript**：注入外部網站的 recorder instrumentation。
- **保留 HTML/SVG/inline JavaScript**：可攜式 HTML preview 與 PDF 輸出。
- **若要重構 preview 編輯器**：先把 editor 狀態與 annotation model 抽成可測試的 TypeScript module，再考慮把 preview 編輯畫面移入 React；不要先改 recorder instrumentation。

## 驗證

```bash
npm run typecheck
npm test
npm run build
```

端到端測試使用 `tests/fixtures/recording-fixture.html`，不依賴外部網站：

```bash
npx vitest run tests/e2e.test.ts
```

## 已知限制

- MVP 使用獨立的 Playwright Chromium 視窗，不會接管既有 Chrome tab，也不包含 Chrome Extension。
- 僅支援 HTTP/HTTPS URL；瀏覽器需要可連線到使用者提供的目標網站。
- 目前不提供 replay、雲端同步、多使用者協作或自動執行工作流程。
- 外部網站的 CSP、跨來源 iframe、瀏覽器權限與動態 layout 可能影響元素資訊或截圖結果。
