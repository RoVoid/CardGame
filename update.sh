#For Ubuntu

REPO="https://github.com/RoVoid/CardGame.git"
DIR="CardGame"

if [ ! -d "$DIR" ]; then
    echo "🔽 Клонируем $REPO"
    git clone "$REPO"
    if [ $? -ne 0 ]; then
        echo "❌ Ошибка при клонировании"
        exit 1
    fi
else
    echo "♻️ Обновляем репозиторий..."
    cd "$DIR" || exit 1
    git pull
    if [ $? -ne 0 ]; then
        echo "❌ Ошибка при обновлении"
        exit 1
    fi
    cd ..
fi

cd "$DIR" || exit 1
echo "📦 Устанавливаем зависимости..."
npm install

echo "✅ Установка завершена"
