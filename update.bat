@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==== 窩Woo！更新網站 ====
echo 只會把新的程式放上 wootw.com，資料庫和用戶資料都不會動。
echo.
call npm install --no-audit --no-fund
call npx wrangler deploy
echo.
if errorlevel 1 (echo 更新失敗，請把這個視窗截圖給 Claude) else (echo 更新完成！打開 https://wootw.com 看看)
pause
