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

## Electron 桌面版

已安裝的 SOP Forge 不需要使用者另外安裝 Node.js、npm、Vite 或啟動 Fastify。Electron 啟動時會在本機 `127.0.0.1` 的動態 port 啟動 API，然後開啟內建 web UI；錄製時使用隨 app 包含的 Playwright Chromium。遠端目標網站仍需要本機網路連線。

### 開發模式

需要在 repository 開發 Electron 時執行：

```bash
npm run dev:desktop
```

這會先建立 `dist-web` 和 `dist-electron`，再啟動 Electron。若只要驗證 server、SQLite、截圖資產與 PDF，不開啟互動視窗，可以執行：

```bash
npm run smoke:desktop
```

### 使用者資料與第一次啟動

桌面版的可寫資料位於 Electron user data 下的 `data/`，不會寫入 app 或 `asar`。預設位置是：

- macOS：`~/Library/Application Support/SOP Forge/data/`
- Windows：`%APPDATA%\\SOP Forge\\data\\`

其中包含 SQLite database、原始/標註圖片與產生的 PDF。第一次啟動如果目前工作目錄仍有 `.sop-forge/`，且桌面資料目錄是空的，app 會複製既有資料並留下 migration marker；來源資料不會因 migration 被刪除。目的地已有資料時不會覆寫，也不會重複 migration。

要安全重設桌面版資料，先關閉 SOP Forge，再備份或刪除上方 `data/` 目錄，重新啟動 app。若要保留舊資料，請先整個複製該目錄；不要只刪除 SQLite 檔案，否則圖片與 project metadata 可能不一致。

### 完整安裝與打包教學

這一節給需要自行產出桌面安裝包的開發者。一般使用者只需要安裝產出的 app，不需要 Node.js、npm 或 Playwright。

#### 1. 安裝開發套件

需求：Node.js 20 以上、npm、Git，以及可連線下載 Chromium 的網路。先在 repository 根目錄執行：

```bash
npm install
npm run playwright:install
```

`npm run playwright:install` 是 web/server 開發模式使用的瀏覽器安裝。正式桌面打包指令會另外執行 `playwright:install:bundled`，把 Chromium 放進 release resources。

#### 2. 先執行開發版

```bash
npm run dev:desktop
```

這會依序建立 `dist-web`、`dist-electron`，在啟動 Electron 前自動將 `better-sqlite3`/`sharp` rebuild 為 Electron ABI，關閉 app 後再恢復為 Node.js ABI。看到 SOP Forge 視窗後，可以測試錄製、截圖、HTML 編輯、標註與 PDF。這個開發指令不需要 Apple、Windows signing 或任何 signing 環境變數。

只驗證 API、SQLite、圖片資產與 PDF 而不開啟互動視窗：

```bash
npm run smoke:desktop
```

#### 3. 產出 macOS app、DMG、ZIP

在 macOS 上執行：

```bash
npm run package:dir
npm run package:mac
```

產物會在 `release/`：

| 指令/產物 | 用途 |
| --- | --- |
| `release/mac-arm64/SOP Forge.app` | Apple Silicon unpacked app，先用於 smoke test |
| `SOP Forge-0.1.0-mac-arm64.dmg` | Apple Silicon 安裝磁碟映像 |
| `SOP Forge-0.1.0-mac-arm64.zip` | Apple Silicon 壓縮版 app |
| `SOP Forge-0.1.0-mac-x64.dmg` | Intel Mac 安裝磁碟映像 |
| `SOP Forge-0.1.0-mac-x64.zip` | Intel Mac 壓縮版 app |

實際版本號會跟隨 `package.json` 的 `version`。`package:dir` 適合先確認 app 可以啟動；`package:mac` 才會產出 DMG/ZIP。沒有 Apple signing identity 時仍可打包，但 macOS 會顯示未識別開發者或需要使用者手動允許開啟。

#### 4. 產出 Windows EXE

建議在 Windows x64 開發機或 CI runner 執行，因為 `better-sqlite3`、`sharp` 和 Playwright browser 需要針對 Windows/Electron ABI 驗證：

```powershell
npm install
npm run package:dir
npm run package:win
```

產物會在 `release/`，主要檔案類似：

```text
SOP Forge-0.1.0-win-x64.exe
```

這是 NSIS installer。使用者執行 `.exe` 後可選擇安裝位置，安裝完成後不需要 Node.js 或 npm。Windows installer 尚未簽署時可能出現 SmartScreen 警告，這是 unsigned development artifact 的正常現象。

macOS 不能可靠地替 Windows 編譯 `better-sqlite3` 這類 native module；在 macOS 執行 `npm run package:win` 可能會出現 `node-gyp does not support cross-compiling native modules from source`。請使用 Windows x64 機器，或在 GitHub Actions 開啟 `.github/workflows/desktop-release.yml`：

1. 到 GitHub repository 的 **Actions**。
2. 選擇 **Desktop release**。
3. 按 **Run workflow**，或推送 `v*` tag。
4. 從 workflow 的 Artifacts 下載 `sop-forge-windows`，裡面就是 `.exe` installer；macOS 產物在 `sop-forge-macos`。

這個 workflow 預設產出 unsigned artifacts，不需要 Apple 或 Windows signing secret；要正式簽署時，再依下方 signing 章節把 secrets 接到 workflow。

#### 5. 打包流程做了什麼

`package:mac` 和 `package:win` 會自動完成：

1. 建立 React web assets。
2. 編譯 Electron main/preload 與本機 Fastify runtime。
3. 下載並複製 Playwright Chromium 到 packaged resources 外部。
4. 針對 Electron ABI rebuild `better-sqlite3`、`sharp` 等 native modules。
5. 產出 app、DMG/ZIP 或 NSIS installer。
6. 打包結束後將 workspace native modules rebuild 回目前 Node.js ABI，避免後續 `npm test` 或 `npm run smoke:desktop` 失敗。

macOS 只能可靠地驗證 macOS app；Windows `.exe` 應在 Windows 啟動一次並測試錄製、SQLite、圖片處理、PDF 與批次匯出。未安裝 Node.js 的使用者只接觸 `release/` 中的安裝包，不需要執行上述 npm 指令。

### 簽署、notarization 與費用

這些環境變數不是全部「直接申請一個帳號就能使用」。它們分為憑證檔案、密碼與帳號識別資訊：

| 變數 | 用途 | 是否要另外付費 |
| --- | --- | --- |
| `CSC_LINK` | macOS Developer ID 憑證的 `.p12` 路徑或 CI secret | 憑證通常來自付費 Apple Developer Program |
| `CSC_KEY_PASSWORD` | `.p12` 匯出時設定的密碼 | 沒有額外費用，只是你自己設定的密碼 |
| `APPLE_ID` | Apple Developer / App Store Connect 帳號 email | Apple ID 免費；但 Developer ID 發行通常需要付費會員 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID 開啟雙重認證後產生的一次性 app-specific password | 免費，不是一般 Apple ID 登入密碼 |
| `APPLE_TEAM_ID` | Apple Developer team 的識別碼 | 會員帳號中的資訊，不是另外購買的項目 |
| `WIN_CSC_LINK` | Windows code-signing `.p12` 憑證路徑或 CI secret | 憑證由憑證機構核發，通常按年付費；價格依供應商與憑證類型而異 |
| `WIN_CSC_KEY_PASSWORD` | Windows `.p12` 匯出時設定的密碼 | 沒有額外費用，只是你自己設定的密碼 |

#### macOS：免費測試 vs 正式發行

- **免費測試**：不設定任何 signing 變數，直接 `npm run package:mac`。可以產出 DMG/ZIP，但屬於 unsigned artifact，其他使用者可能看到 Gatekeeper 警告。
- **正式發行**：通常需要加入 Apple Developer Program。Apple Developer Program 一般是每年 USD 99，實際價格可能依國家/地區與 Apple 最新政策變動；Developer ID Application 憑證與 notarization 需要在會員帳號中申請/建立。
- `APPLE_ID`、app-specific password、`APPLE_TEAM_ID` 本身不是額外收費服務；費用主要是 Apple Developer Program 會員資格。
- 若只是公司內部測試，可以先使用 unsigned DMG，不必先付費；若要讓一般使用者少遇到安全性阻擋，才需要正式 signing/notarization。

#### Windows：免費測試 vs 正式發行

- **免費測試**：不設定 `WIN_CSC_*`，直接 `npm run package:win`。可以產出 `.exe`，但 SmartScreen 可能顯示未知發行者。
- **正式發行**：購買受信任憑證機構提供的 code-signing certificate，價格、驗證要求與信譽建立時間依供應商和 OV/EV 類型而不同。
- 自行產生 self-signed certificate 可以測試簽署流程，但一般使用者的 Windows 不會信任它，不能消除 SmartScreen 警告。

#### 有憑證時的環境變數範例

先把憑證放在安全位置，再在目前 terminal/CI secret 中設定，不要提交到 Git：

macOS zsh：

```bash
export CSC_LINK="$HOME/secrets/developer-id.p12"
export CSC_KEY_PASSWORD='你的p12密碼'
export APPLE_ID='developer@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='Apple產生的app-specific password'
export APPLE_TEAM_ID='你的Team ID'
npm run package:mac
```

Windows PowerShell：

```powershell
$env:WIN_CSC_LINK = "$HOME\\secrets\\sop-forge-code-signing.p12"
$env:WIN_CSC_KEY_PASSWORD = "你的p12密碼"
npm run package:win
```

`CSC_LINK`/`WIN_CSC_LINK` 不是向 Apple 或 Microsoft 直接取得的固定字串；它們指向你已取得的憑證檔案。`CSC_KEY_PASSWORD`/`WIN_CSC_KEY_PASSWORD` 也不是平台發給你的密碼，而是匯出 `.p12` 時設定的密碼。CI 建議使用 secret manager，並確認 signing variables 已設定但憑證無效時讓 build 失敗。

### 桌面版批次圖片匯出

錄製完成後，桌面版會顯示 `Download images` 與 `Download ZIP`。匯出範圍是 project 中目前保存且狀態為 `ready` 的原始 screenshot assets，不會把尚未保存的 editor 狀態重新 rasterize，也不會修改 project、原始圖片或 editor document。

- `Download images` 會讓使用者選擇資料夾，每個 ready asset 會輸出成一個檔案。
- `Download ZIP` 會讓使用者選擇 `.zip` 路徑，內容使用相同的檔名規則。
- 檔名由 step 順序、step title 與 asset id 組成，會清除路徑分隔符、Windows 保留字元與尾端空白，重複名稱會加上穩定序號。
- ready 以外、遺失或不在 data directory 內的資產會被跳過並回報原因；可用資產仍會完成匯出。
- 重複匯出使用明確的 overwrite policy：目的資料夾中的同名檔案會被目前保存的來源 asset 覆寫，ZIP 會以暫存檔完成後再替換目的檔案。
- 使用者取消原生 folder/ZIP dialog 時不會建立輸出，也不會改動來源資料。

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
npm run smoke:desktop
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

## 疑難排解

- **桌面 app 無法啟動**：確認 `dist-web` 已隨 build 產生；開發時重新執行 `npm run build:web && npm run build:electron`，再查看主程序錯誤對話框。
- **錄製瀏覽器沒有開啟**：確認目標 URL 是 HTTP/HTTPS 且本機可連線；打包版必須使用包含 Playwright browser resources 的完整 artifact，不要只複製 app bundle 內的部分檔案。
- **`better-sqlite3` ABI 錯誤**：請使用 `npm run dev:desktop`，它會在啟動 Electron 前自動切換 Electron ABI，關閉後恢復 Node.js ABI。若曾經手動中斷打包流程，先執行 `npm rebuild better-sqlite3 sharp` 還原 Node.js ABI，再重新執行 `npm run dev:desktop`。
- **macOS 顯示未識別開發者**：本地未簽署 artifact 需要在系統安全性設定中允許開啟；對外發行請提供 Developer ID signing 與 notarization credentials。
- **Windows 顯示 SmartScreen 警告**：未簽署 NSIS 是開發 artifact；正式發行請設定 Windows code-signing certificate。
