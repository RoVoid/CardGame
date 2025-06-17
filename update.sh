#!/bin/bash
set -e

if [ ! -d ".git" ]; then
  echo "📦 Клонирование репозитория..."
  git clone https://github.com/RoVoid/CardGame.git .
  echo "✅ Клонирование завершено"
  echo "🛠️ Установка NPM-Пакетов..."
  npm install
  echo "✅ Установка завершена"
  echo 🛠️ Сборка JS...
  call npm run build >nul
  echo ✅ Сборка завершена
  echo
else
  echo "🔄 Проверка обновлений..."
  git fetch origin

  LOCAL_COMMIT=$(git rev-parse HEAD)
  REMOTE_COMMIT=$(git rev-parse origin/main)

  echo "🖥️ Локальный коммит: $LOCAL_COMMIT"
  echo "☁️ Удалённый коммит: $REMOTE_COMMIT"
  echo

  if ! git merge-base --is-ancestor "$REMOTE_COMMIT" "$LOCAL_COMMIT"; then
    echo "🔄 Обновление репозитория..." 
    if ! git pull --ff-only; then
      echo ⚠️ Синхронизация не удалась!
    else
      echo "✅ Обновление завершено"
      echo "🛠️ Установка NPM-Пакетов..."
      npm install
      echo "✅ Установка завершена"
      echo 🛠️ Сборка JS...
      call npm run build >nul
      echo ✅ Сборка завершена
    fi
    echo
  fi
fi

echo "⏱️ Запуск игры..."
npm run start
