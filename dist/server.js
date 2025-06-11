"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = require("ws");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const os_1 = __importDefault(require("os"));
const pidusage_1 = __importDefault(require("pidusage"));
const readline_1 = __importDefault(require("readline"));
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const wss = new ws_1.WebSocketServer({ server });
const players = [];
const cardsTemplate = {
    '0': 10,
    '1': 10,
    '2': 10,
    '3': 10,
    '4': 3,
    plus: 3,
    bin: 3,
    swap: 3,
};
const maxPlayerCount = 9;
let maxSum = 12;
let isGame = false;
let cards = [];
let sum = 0;
let startIndex = -1;
let moveIndex = -1;
let closing = false;
const rl = readline_1.default.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🖥️>  ',
});
rl.prompt();
function log(...args) {
    const line = rl.line;
    const pos = rl.cursor;
    readline_1.default.clearLine(process.stdout, 0);
    readline_1.default.cursorTo(process.stdout, 0);
    console.log(...args);
    rl.prompt(true);
    rl.write(null, { ctrl: true, name: 'u' });
    rl.write(line);
    const offset = line.length - pos;
    if (offset > 0)
        readline_1.default.moveCursor(process.stdout, -offset, 0);
}
function warn(...args) {
    log(['⚠️', ...args]);
}
function error(...args) {
    log(['❌', ...args]);
}
app.use(express_1.default.static(path_1.default.join(__dirname, 'client')));
wss.on('connection', (ws) => {
    if (isGame || players.length >= maxPlayerCount) {
        ws.close(isGame ? 1001 : 1002); // '🛑 Игра уже началась или нет мест'
        return;
    }
    const uuid = (0, crypto_1.randomUUID)();
    const player = { uuid, ws, cards: [], usedCards: [], sum: 0, nickname: `Игрок ${players.length}` };
    players.push(player);
    send(ws, 'index', { uuid, nickname: player.nickname });
    log(`✅ ${player.nickname} подключается`);
    ws.on('message', (rawData) => {
        try {
            const { type, data } = JSON.parse(rawData.toString());
            if (!type)
                return;
            const player = players.find((p) => p.ws === ws);
            if (!player)
                return;
            if (type === 'nickname') {
                let oldNickname = player.nickname;
                player.nickname = data?.nickname?.trim().slice(0, 16) || player.nickname;
                if (oldNickname !== player.nickname)
                    log(`✏️ ${oldNickname} переименуется в ${player.nickname}`);
                if (isGame)
                    broadcast('gameStats', getGameStats());
                send(ws, type, { nickname: player.nickname });
            }
            else if (type === 'use') {
                if (!isGame || moveIndex < 0 || players[moveIndex]?.uuid !== player.uuid || !data)
                    return;
                const { cardType, targetUUID } = data;
                if (!player.cards.includes(cardType))
                    return;
                const target = players.find((p) => p.uuid === targetUUID);
                if (!target)
                    return;
                const isNumber = ['0', '1', '2', '3', '4'].includes(cardType);
                if ((isNumber && target.uuid !== player.uuid) || (!isNumber && cardType !== 'bin' && target.cards.length === 0))
                    return;
                player.usedCards.push(cardType);
                player.cards.splice(player.cards.indexOf(cardType), 1);
                log(`🎴 ${player.nickname} использует '${cardType}' ${target !== player ? `на ${target.nickname}` : ''}`);
                if (isNumber) {
                    const v = parseInt(cardType);
                    sum += v;
                    player.sum += v;
                    send(player.ws, 'stats', { cards: player.cards, sum: player.sum });
                    if (sum > maxSum)
                        return endGame();
                }
                else {
                    handleSpecial(cardType, player, target);
                }
                if (!isGame)
                    return;
                moveIndex = (moveIndex + 1) % players.length;
                broadcast('gameStats', getGameStats());
                // Пополнение рук, если кто-то остался без карт
                if (players[moveIndex].cards.length === 0) {
                    for (const pl of players) {
                        while (pl.cards.length < 4 && cards.length) {
                            pl.cards.push(cards.pop());
                            if (cards.length === 0)
                                shuffleCards();
                        }
                        send(pl.ws, 'stats', { cards: pl.cards, sum: pl.sum });
                    }
                    broadcast('gameStats', getGameStats());
                }
                log(`🎮 Ход игрока: ${players[moveIndex].nickname}`);
            }
            else
                log(`Неизвестное сообщение от ${player.nickname}: (${type})\n${data}`);
        }
        catch (e) {
            warn('⚠️ Ошибка:', e);
        }
    });
    ws.on('close', (code) => {
        const index = players.findIndex((p) => p.ws === ws);
        if (index !== -1) {
            const player = players[index];
            players.splice(index, 1);
            log(`❌ ${player.nickname} отключился`);
            if (isGame) {
                broadcast('playerLeft', { nickname: player.nickname });
                if (players.length === 0)
                    endGame(true);
            }
        }
    });
});
function handleSpecial(card, from, to) {
    if (card === 'plus') {
        sum++;
        from.sum++;
        let changed = false;
        for (let i = 0; i < to.cards.length; i++) {
            if (['0', '1', '2', '3'].includes(to.cards[i])) {
                to.cards[i] = String((parseInt(to.cards[i]) + 1) % 4);
                changed = true;
            }
        }
        if (changed)
            send(to.ws, 'stats', { cards: to.cards });
        send(from.ws, 'stats', { cards: from.cards, sum: from.sum });
        if (sum > maxSum)
            endGame();
    }
    else if (card === 'bin') {
        sum -= to.sum;
        to.sum = 0;
        to.usedCards = [];
        send(from.ws, 'stats', { cards: from.cards });
        send(to.ws, 'stats', { sum: 0 });
    }
    else if (card === 'swap') {
        if (from.uuid !== to.uuid) {
            [from.cards, to.cards] = [to.cards, from.cards];
            if (to.cards.length < from.cards.length)
                to.cards.push('0');
            send(to.ws, 'stats', { cards: to.cards });
        }
        send(from.ws, 'stats', { cards: from.cards });
    }
}
function startGame() {
    if (players.length < 2)
        return log('👥 Недостаточно игроков');
    if (isGame)
        return log('⚠️ Игра уже начата');
    sum = 0;
    maxSum = Math.max(12, players.length * 4);
    shuffleCards();
    for (const pl of players) {
        pl.cards = [];
        pl.usedCards = [];
        pl.sum = 0;
        for (let i = 0; i < 4; i++)
            pl.cards.push(cards.pop());
    }
    startIndex = (startIndex + 1) % players.length;
    moveIndex = startIndex;
    isGame = true;
    for (const pl of players) {
        send(pl.ws, 'gameStats', getGameStats());
        send(pl.ws, 'stats', { cards: pl.cards });
    }
    log(`🎮 Игра началась! Ход игрока: ${players[startIndex].nickname}`);
}
function endGame(termite = false) {
    isGame = false;
    if (!closing)
        broadcast('gameStats', getGameStats());
    if (termite) {
        log(`🏁 Игра отмена!\n`);
        broadcast('loser');
    }
    else {
        if (!closing)
            broadcast('loser', { uuid: players[moveIndex]?.uuid, nickname: players[moveIndex]?.nickname });
        log(`🏁 Игра окончена! Проиграл ${players[moveIndex]?.nickname}\n`);
    }
}
function getGameStats() {
    return {
        isGame,
        startUUID: players[startIndex]?.uuid,
        moveUUID: players[moveIndex]?.uuid,
        maxSum,
        players: players.map((p) => ({
            uuid: p.uuid,
            nickname: p.nickname,
            count: p.cards.length,
            usedCards: p.usedCards,
            sum: p.sum,
        })),
    };
}
function send(ws, type, data) {
    if (ws.readyState === ws_1.WebSocket.OPEN)
        ws.send(JSON.stringify({ type, data }));
}
function broadcast(type, data) {
    for (const p of players)
        send(p.ws, type, data);
}
function shuffleCards() {
    cards = [];
    for (const type in cardsTemplate) {
        for (let i = 0; i < cardsTemplate[type]; i++)
            cards.push(type);
    }
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
}
function closeServer() {
    closing = true;
    endGame(true);
    if (players.length)
        log('🕓 Завершение соединений...');
    for (const pl of players) {
        try {
            if (pl.ws.readyState === ws_1.WebSocket.OPEN)
                pl.ws.close(1000); // 'Сервер завершил работу'
        }
        catch { }
    }
    wss.close((err) => {
        if (err)
            log('🛑 Принудительная остановка WebSocket сервера!');
        else
            log('✅ WebSocket сервер завершён');
        server.close((err) => {
            if (err)
                log('🛑 Принудительная остановка HTTP сервера!');
            else
                log('✅ HTTP сервер завершён');
            readline_1.default.clearLine(process.stdout, 0);
            process.exit(0);
        });
    });
}
const commands = {
    start: startGame,
    stop: () => endGame(true),
    exit: closeServer,
    termite: () => process.exit(0),
    say: (args) => {
        if (!args)
            return log('🚫 Пустое сообщение!');
        log('📢 Сообщение игрокам:', args);
        broadcast('say', { msg: args });
    },
    list: () => console.table(players.map((p) => ({
        nickname: p.nickname,
        uuid: p.uuid,
        sum: p.sum,
    }))),
    cards: () => console.table(players.map((p) => ({
        nickname: p.nickname,
        sum: p.sum,
        cards: p.cards,
        usedCards: p.usedCards,
    }))),
    cls: () => console.clear(),
    memory: () => {
        (0, pidusage_1.default)(process.pid)
            .then((stat) => {
            const mem = process.memoryUsage();
            const fmt = (val) => val > 1024 * 1024
                ? (val / 1024 / 1024).toFixed(1).padStart(6) + ' MB'
                : (val / 1024).toFixed(1).padStart(6) + ' KB';
            log('\n📟 Ресурсы сервера:');
            log(`• ⏱️ Uptime:         ${(stat.elapsed / 1000).toFixed(2).padStart(5)} sec`);
            log(`• 🧠 CPU:            ${stat.cpu.toFixed(1).padStart(5)} %`);
            log(`• 👥 Игроков:        ${players.length.toFixed(0).padStart(5)}\n`);
            log('💾 Использование памяти:');
            log(`• 📦 RSS (всё):      ${fmt(mem.rss)}   — весь процесс Node.js`);
            log(`• 🧮 Heap Всего:     ${fmt(mem.heapTotal)}   — выделено V8`);
            log(`• 🔧 Heap Занято:    ${fmt(mem.heapUsed)}   — используется JS`);
            log(`• 📤 Внешнее:        ${fmt(mem.external)}   — буферы, ws`);
            log(`• 📚 ArrayBuffer:    ${fmt(mem.arrayBuffers)}\n`);
        })
            .catch((err) => {
            error('❌ Ошибка получения ресурсов:', err);
        });
    },
};
rl.on('line', (input) => {
    const [cmd, ...rest] = input.trim().split(' ');
    const fn = commands[cmd];
    if (fn)
        fn(rest.join(' '));
    else
        log('❓ Неизвестная команда');
});
process.on('SIGINT', closeServer);
const PORT = 8080;
server.listen(PORT, () => {
    log(`🚀 Сервер запущен на:`);
    log(`  💻 http://localhost:${PORT}`);
    const nets = os_1.default.networkInterfaces();
    for (const name in nets) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                const addr = net.address;
                const emoji = addr.startsWith('192.') || addr.startsWith('10.') || addr.startsWith('172.') ? '🏠' : '🌐';
                log(`  ${emoji} http://${addr}:${PORT}`);
            }
        }
    }
});
