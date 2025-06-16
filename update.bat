@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

if "%~1" == "/update" goto update

copy "%~f0" "launch.bat" >nul
start "" "launch.bat" /update
exit

:update
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo 📦 Клонирование...
    git clone https://github.com/RoVoid/CardGame.git temp_clone >nul
    xcopy /e /h /y temp_clone\* . >nul
    rd /s /q temp_clone >nul
    echo ✅ Клонирование завершено
    echo 🛠️ Установка NPM-Пакетов...
    npm install >nul
    echo ✅ Установка завершена
    echo:
    goto launch
)

git fetch origin >nul 2>&1
for /f %%i in ('git rev-parse HEAD') do set "LOCAL_COMMIT=%%i"
for /f %%i in ('git rev-parse origin/main') do set "REMOTE_COMMIT=%%i"

echo 🖥️ Локальный коммит: !LOCAL_COMMIT!
echo ☁️ Удалённый коммит: !REMOTE_COMMIT!
echo:

git merge-base --is-ancestor !REMOTE_COMMIT! !LOCAL_COMMIT! >nul 2>&1
if errorlevel 1 (
    echo 🔄 Обновление...
    git pull >nul
    echo ✅ Синхронизация завершена
    echo:
)

:launch
echo ⏱️ Запуск игры...
call npm run start
del /f /q "%~f0" >nul && pause && exit