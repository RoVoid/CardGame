@REM For Windows

@echo off
set ZIP=cardgame.zip
set FOLDER=CardGame-main
set URL=https://github.com/RoVoid/CardGame/archive/refs/heads/main.zip

echo 🔽 Скачиваем архив...
curl -L -o %ZIP% %URL%
if errorlevel 1 (
    echo ❌ Ошибка при скачивании
    pause
    exit /b 1
)

echo 📂 Распаковываем архив...
powershell -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '.' -Force"
if errorlevel 1 (
    echo ❌ Ошибка при распаковке
    pause
    exit /b 1
)
del %ZIP%

echo 📁 Перемещаем содержимое...
xcopy "%FOLDER%\*" "." /E /H /Y >nul
rd /s /q "%FOLDER%"

echo 📦 Устанавливаем зависимости...
npm install

echo ✅ Установка завершена
pause