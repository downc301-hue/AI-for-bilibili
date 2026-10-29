@echo off
chcp 65001 >nul
cd /d d:\wwwroot\doubao-bot
set GIT="C:\Program Files\Git\cmd\git.exe"

echo === status ===
%GIT% status --short

echo.
echo === adding files ===
%GIT% add README.md web-ui/*.png

echo.
echo === status after add ===
%GIT% status --short

echo.
echo === committing ===
%GIT% commit -m "docs: rewrite Web UI guide with 11 screenshots"

echo.
echo === pushing ===
%GIT% push origin HEAD:main

echo.
echo === DONE ===
pause