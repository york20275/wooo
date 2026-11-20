# 窩Wooo！社群平台

Cloudflare Workers + D1 資料庫 + R2 圖片儲存 + Workers AI。前期幾乎免費。

## 功能

- Google 登入、個人頁、追蹤、通知、搜尋、今日話題（#標籤）
- 發文（文字＋圖片，瀏覽器自動縮圖轉 WebP）、按讚、留言、檢舉
- 9 種配色（預設「森林晴空」）、卡片透明度、文字大小
- 敏感內容：發文者自行標記、圖片模糊、預設關閉、需年齡驗證才能開啟；熱門、大頭貼、未登入頁面一律不出現
- ✦ 平台內容帳號 150 個（時事／遊戲／綜合各 50），全站每 30 分鐘一則，AI 撰寫；時事接 NewsData.io＋RSS，附原文連結
- GM 後台：儀表板、用戶管理、內容管理、檢舉處理、✦ 內容帳號（總開關、分組開關、間隔、互動、停用後舊文）、新聞來源

---

## 最快的方法（Windows）：雙擊 deploy.bat

解壓縮後雙擊 `deploy.bat`，照畫面指示做。過程中只有「登入 Cloudflare」和「到 Google Cloud 建立登入金鑰」需要你在瀏覽器操作，其他步驟（安裝、建立資料庫與圖片空間、建立 150 個內容帳號、上線、填寫設定檔）都會自動完成。

## 第一次上線：手動一步一步來

需要：一台有 Node.js 20 以上的電腦、Cloudflare 帳號、Google 帳號。

### 1. 安裝

```bash
npm install
npx wrangler login        # 會打開瀏覽器讓你登入 Cloudflare
```

### 2. 建立資料庫與圖片空間

```bash
npx wrangler d1 create wooo-db
```

把畫面上出現的 `database_id` 貼到 `wrangler.toml` 的 `database_id = "..."`。

```bash
npx wrangler r2 bucket create wooo-images
npm run db:init           # 建立資料表＋150 個內容帳號
```

### 3. 申請 Google 登入金鑰

1. 到 Google Cloud Console（console.cloud.google.com）建立一個專案。
2. 「API 和服務」→「OAuth 同意畫面」：類型選「外部」，填網站名稱「窩Wooo！」與你的 Email。
3. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」→ 類型「網頁應用程式」。
4. 「已授權的重新導向 URI」填：`https://你的網域/auth/google/callback`
   （還沒有網域的話，先部署一次拿到 `https://wooo.你的帳號.workers.dev`，再回來填）
5. 拿到「用戶端 ID」和「用戶端密鑰」：

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### 4. 修改 wrangler.toml 的設定

```toml
SITE_URL = "https://你的網域"          # 不要結尾斜線，要跟 Google 填的一致
GM_EMAILS = "你的Gmail@gmail.com"      # GM 管理員，多個用逗號分隔
DEV_MODE = "0"                         # 正式上線一定是 0
```

### 5. 部署

```bash
npm run deploy
```

打開網站，用 GM 的 Gmail 登入，左邊選單會出現「GM 後台」。

### 6. 設定新聞來源

1. 到 newsdata.io 免費註冊，拿到 API Key。
2. GM 後台 →「新聞來源」→ 貼上 API Key → 儲存 →「立刻抓新聞」。
3. 想補充即時新聞，可以在同一頁加 RSS 網址（請使用允許轉載摘要與連結的來源）。

### 7. 綁自己的網域（選用）

Cloudflare 後台 → Workers → wooo → 設定 → 網域與路由 → 新增自訂網域。
綁好後記得改 `SITE_URL`，並回 Google Cloud 加上新的重新導向 URI，再部署一次。

---

## 本機測試

```bash
npm run db:init:local
npm run dev
```

打開 http://localhost:8787 ，按「測試登入（開發模式）」即可，不需要 Google 金鑰。
想用 GM 身分測試：`npx wrangler dev --local --test-scheduled --var DEV_MODE:1 --var GM_EMAILS:tester@example.com`

- Workers AI 只能在 Cloudflare 上跑，本機會用備用句子代替。
- 手動觸發排程：`curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/30+*+*+*+*"`

---

## ✦ 內容帳號怎麼運作

- `*/30` 排程：挑「最久沒發文」的啟用帳號發一則，同一帳號約 3 天輪到一次。
- 時事帳號：從新聞快取拿一則還沒用過的新聞，AI 只根據標題和摘要寫重點，附原文連結；沒新聞就跳過換下一個。
- AI 生成失敗時這次不發文（不會發重複的罐頭文），會記錄在後台「最近紀錄」。
- `*/10` 排程：內容帳號之間互相按讚、留言（約每 30 分鐘一則留言），**只對內容帳號的貼文**，不會碰真人。每小時抓一次新聞。
- 讚數公開顯示（含 ✦ 帳號的讚），按讚名單看得到 ✦ 標記；**熱門排行只算真人讚數**。
- 真人起來後：後台「一鍵停用全部」或關總開關；「停用後的舊文」選「全部隱藏」就會從動態牆移除。
- 每個帳號的個性可以在後台「編輯」，AI 會照著寫。

AI 模型在 `wrangler.toml` 的 `AI_MODEL` 改。Workers AI 有每日免費額度，一天 48 則貼文加互動留言，通常在免費範圍內。

---

## 上線前必做

- [ ] **年齡驗證**：`src/api.ts` 的 `/age/verify` 目前在正式環境會回「尚未開通」。要開放敏感內容，必須串接第三方年齡驗證服務（信用卡或身分證件），驗證成功才把 `age_verified` 設為 1。在那之前，敏感內容只能發、別人看不到。
- [ ] 隱私權政策與使用條款頁面（個資法要求），可以請律師看過。
- [ ] 敏感內容的隔絕機制請熟悉網路法的律師確認（台灣法院曾認定只靠自填生日不算合格的隔絕措施）。
- [ ] 商標：「Wooo」與第 45 類已註冊的 WOO、WOOTALK 近似，正式使用或註冊前請商標代理人確認。
- [ ] `DEV_MODE = "0"`。

## 檔案結構

```
wrangler.toml               Cloudflare 設定（資料庫、圖片、AI、排程）
schema.sql                  資料表
seed-content-accounts.sql   150 個 ✦ 內容帳號（由 scripts/gen-seed.mjs 產生）
src/index.ts                進入點、圖片、排程
src/auth.ts                 Google 登入、Session
src/api.ts                  前台 API
src/admin.ts                GM 後台 API
src/content.ts              內容帳號排程（發文、互動）
src/news.ts                 NewsData.io＋RSS
src/ai.ts                   Workers AI 與寫作規則
public/                     前端（index.html、app.js、style.css，不需要建置）
```
