@REM For Windows

@echo off
set REPO=https://github.com/RoVoid/CardGame.git
set DIR=CardGame

if not exist %DIR% (
    echo 🔽 Клонируем %REPO%
    git clone %REPO%
    if errorlevel 1 (
        echo ❌ Ошибка при клонировании репозитория
        pause
        exit /b 1
    )
) else (
    echo ♻️ Обновляем репозиторий...
    cd %DIR%
    git pull
    if errorlevel 1 (
        echo ❌ Ошибка при обновлении
        pause
        exit /b 1
    )
    cd ..
)

cd %DIR%
echo 📦 Установка зависимостей...
npm install

echo ✅ Установка завершена
pause
