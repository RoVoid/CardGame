@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

git fetch origin >nul 2>&1

for /f %%A in ('git rev-parse HEAD') do set local_hash=%%A
for /f %%A in ('git rev-parse origin/main') do set remote_hash=%%A

echo 🖥️ Локальный коммит: %local_hash%
echo ☁️ Удалённый коммит: %remote_hash%

if "%local_hash%"=="%remote_hash%" (
    echo ✅ Коммиты идентичны
) else (
    echo ⚠️ Коммиты разные
    echo 📦 Установка обновления...
    git pull
    echo ✅ Установка завершена
)

echo ⏱️ Запуск игры...
npm run start
