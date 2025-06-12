#!/bin/bash

git fetch origin

local_hash=$(git rev-parse HEAD)
remote_hash=$(git rev-parse origin/main)

echo "🖥️ Локальный коммит: $local_hash"
echo "☁️ Удалённый коммит: $remote_hash"

if [[ "$local_hash" == "$remote_hash" ]]
then
    echo "✅ Коммиты идентичны"
else
    echo "⚠️ Коммиты разные"
    echo "📦 Установка обновления..."
    git pull
    echo "✅ Установка завершена"
fi

echo "⏱️ Запуск игры..."
npm run start
