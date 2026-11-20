# 窩Woo！一鍵部署腳本（Windows PowerShell）
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Step($t) { Write-Host ""; Write-Host "==== $t ====" -ForegroundColor Green }
function Fail($t) { Write-Host ""; Write-Host "!! $t" -ForegroundColor Red; Write-Host "把上面的錯誤訊息複製給 Claude，就能幫你看。"; Read-Host "按 Enter 結束"; exit 1 }
function SetToml($key, $value) {
  $p = Join-Path $PSScriptRoot 'wrangler.toml'
  $c = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
  $c = [regex]::Replace($c, "(?m)^$key\s*=\s*`".*?`"", "$key = `"$value`"")
  [System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding $false))
}

Write-Host "窩Woo！一鍵部署" -ForegroundColor Cyan
Write-Host "過程中會打開瀏覽器兩次：登入 Cloudflare、設定 Google 登入。其他都會自動完成。"

Step "1/8 檢查 Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "你的電腦還沒有安裝 Node.js，即將打開下載頁面。"
  Write-Host "請下載「LTS」版本、照預設選項安裝完成後，再重新雙擊 deploy.bat。"
  Start-Process "https://nodejs.org/"
  Read-Host "按 Enter 結束"; exit 1
}
Write-Host ("Node.js 版本：" + (node -v))

Step "2/8 安裝套件（第一次約 1～2 分鐘）"
npm install
if ($LASTEXITCODE -ne 0) { Fail "套件安裝失敗，請確認網路連線。" }

Step "3/8 登入 Cloudflare"
Write-Host "瀏覽器會打開 Cloudflare 頁面：沒有帳號請先免費註冊，登入後按「Allow」。"
npx wrangler login
if ($LASTEXITCODE -ne 0) { Fail "Cloudflare 登入失敗。" }

$gm = Read-Host "請輸入要當 GM 管理員的 Gmail（例如 abc@gmail.com）"
if ($gm -notmatch '@') { Fail "Gmail 格式不正確。" }
SetToml 'GM_EMAILS' $gm.Trim()

$env:CI = 'true'   # 之後的步驟不再跳出確認問題

Step "4/8 建立資料庫"
$tomlPath = Join-Path $PSScriptRoot 'wrangler.toml'
$tomlBak = [System.IO.File]::ReadAllText($tomlPath, [System.Text.Encoding]::UTF8)
$out = (npx wrangler d1 create wooo-db 2>&1 | Out-String)
Write-Host $out
# 有些版本會自動把設定加進 wrangler.toml 造成重複，這裡還原後再由腳本填入 ID
[System.IO.File]::WriteAllText($tomlPath, $tomlBak, (New-Object System.Text.UTF8Encoding $false))
$m = [regex]::Match($out, 'database_id"?\s*[=:]\s*"([0-9a-fA-F-]{36})"')
$dbid = if ($m.Success) { $m.Groups[1].Value } else { $null }
if (-not $dbid) {
  $list = (npx wrangler d1 list --json 2>$null | Out-String)
  try { $dbid = (($list | ConvertFrom-Json) | Where-Object { $_.name -eq 'wooo-db' } | Select-Object -First 1).uuid } catch {}
}
if (-not $dbid) { Fail "找不到資料庫 ID。" }
SetToml 'database_id' $dbid
Write-Host "資料庫 ID：$dbid"

Step "5/8 建立圖片空間（R2）"
while ($true) {
  $r2 = (npx wrangler r2 bucket create wooo-images 2>&1 | Out-String)
  Write-Host $r2
  if ($LASTEXITCODE -eq 0 -or $r2 -match 'already exists|already own') { break }
  Write-Host "看起來還沒開通 R2。即將打開 Cloudflare 後台，請點左邊選單的「R2」並按開通（免費額度內不會扣款）。" -ForegroundColor Yellow
  Start-Process "https://dash.cloudflare.com/?to=/:account/r2"
  Read-Host "開通完成後按 Enter 重試"
}

Step "6/8 建立資料表與 150 個 ✦ 內容帳號"
npx wrangler d1 execute wooo-db --remote --file=schema.sql
if ($LASTEXITCODE -ne 0) { Fail "建立資料表失敗。" }
npx wrangler d1 execute wooo-db --remote --file=seed-content-accounts.sql
if ($LASTEXITCODE -ne 0) { Fail "建立內容帳號失敗。" }

Step "7/8 上線"
$env:CI = $null
Write-Host "第一次上線時，Cloudflare 可能會請你取一個 workers.dev 子網域名稱，照畫面輸入英文名稱即可。"
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { Fail "上線失敗。" }
$site = ''
while ($site -notmatch '^https://[a-zA-Z0-9.-]+\.workers\.dev$') {
  $site = (Read-Host "請複製上面顯示的網址（https://開頭、.workers.dev 結尾）貼上後按 Enter").Trim().TrimEnd('/')
}
SetToml 'SITE_URL' $site
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { Fail "更新網址後重新上線失敗。" }
Write-Host "你的網站：$site" -ForegroundColor Cyan

Step "推播通知金鑰"
$vk = (node scripts/gen-vapid.mjs | ConvertFrom-Json)
$vk.public | npx wrangler secret put VAPID_PUBLIC_KEY
$vk.private | npx wrangler secret put VAPID_PRIVATE_JWK
SetToml 'VAPID_SUBJECT' ("mailto:" + $gm.Trim())
npx wrangler deploy | Out-Null

Step "8/8 設定 Google 登入"
$cb = "$site/auth/google/callback"
Set-Clipboard -Value $cb -ErrorAction SilentlyContinue
Write-Host "即將打開 Google Cloud。請照這幾步做："
Write-Host "  1. 建立一個專案（左上角選專案 → 新增專案）"
Write-Host "  2. 「OAuth 同意畫面」：類型選「外部」，應用程式名稱填「窩Woo！」"
Write-Host "  3. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」→ 類型選「網頁應用程式」"
Write-Host "  4. 「已授權的重新導向 URI」貼上（已複製到剪貼簿）："
Write-Host "     $cb" -ForegroundColor Yellow
Write-Host "  5. 建立後會看到「用戶端 ID」和「用戶端密鑰」"
Start-Process "https://console.cloud.google.com/apis/credentials"
Read-Host "拿到兩串金鑰後按 Enter 繼續"
Write-Host "請貼上「用戶端 ID」後按 Enter："
npx wrangler secret put GOOGLE_CLIENT_ID
Write-Host "請貼上「用戶端密鑰」後按 Enter："
npx wrangler secret put GOOGLE_CLIENT_SECRET

Write-Host ""
Write-Host "完成！網站：$site" -ForegroundColor Green
Write-Host "用 $gm 登入後，左邊選單會出現「GM 後台」。"
Write-Host "記得到「GM 後台 → 新聞來源」貼上 NewsData.io 的 API Key，時事帳號才會開始發文。"
Start-Process $site
Read-Host "按 Enter 結束"
