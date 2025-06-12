import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import os from 'os';
import pidusage from 'pidusage';
import readline from 'readline';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import { applyConfig, endGame, handleConnect, handleDisconnect, handleCardUse, startGame, handleCloseServer, nextMove, } from './game.js';
const app = express();
app.use(cookieParser());
const server = createServer(app);
const wss = new WebSocketServer({ server });
const clients = {};
let clientsNumber = 0;
export let closing = false;
const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
applyConfig(config);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../client')));
app.get('/cookies', (req, res) => {
    let { uuid, nickname } = req.cookies;
    if (!uuid) {
        uuid = randomUUID();
        res.cookie('uuid', uuid, {
            httpOnly: false,
            sameSite: 'lax',
            path: '/',
        });
    }
    if (!nickname) {
        nickname = 'Игрок ' + clientsNumber;
        res.cookie('nickname', nickname, {
            httpOnly: false,
            sameSite: 'lax',
            path: '/',
        });
    }
    log(`✅ ${nickname} подключается`);
    log(`   ${uuid}`);
    res.status(200).send();
    // res.sendFile(path.join(__dirname, '../client/index.html'));
});
wss.on('connection', (ws) => {
    let client;
    ws.once('message', (data) => {
        const { uuid, nickname } = JSON.parse(data.toString());
        if (!uuid || !nickname) {
            ws.close();
            return;
        }
        let reconnected = clients[uuid] != undefined;
        if (reconnected)
            clients[uuid].ws?.close();
        client = { uuid, ws, nickname };
        clients[uuid] = client;
        if (!handleConnect(client, reconnected))
            return;
        log(`✅ ${client.nickname} авторизуется`);
        ws.on('message', (rawData) => {
            try {
                const { type, data } = JSON.parse(rawData.toString());
                if (!type)
                    return;
                switch (type) {
                    case 'nickname': {
                        let oldNickname = client.nickname;
                        client.nickname = data?.nickname?.trim().slice(0, 16) || client.nickname;
                        if (oldNickname !== client.nickname)
                            log(`✏️ ${oldNickname} переименуется в ${client.nickname}`);
                        sendTo(type, { nickname: client.nickname });
                        //changeNickname(client.uuid, client.nickname);
                        break;
                    }
                    case 'use': {
                        handleCardUse(client.uuid, data?.cardType, data?.targetIndex);
                        break;
                    }
                    default: {
                        warn(`Неизвестное сообщение от ${client.nickname}: (${type})\n${JSON.stringify(data)}`);
                        break;
                    }
                }
            }
            catch (e) {
                error('Ошибка:', e);
            }
        });
    });
    ws.on('close', (code) => {
        if (!client)
            return;
        delete clients[client.uuid];
        if (closing)
            error(`${client.nickname} отключился`);
        else
            setTimeout(() => {
                if (!clients[client.uuid]) {
                    handleDisconnect(client.uuid, code);
                    error(`${client.nickname} отключился`);
                }
            }, 500);
    });
    function sendTo(type, data) {
        send(ws, type, data);
    }
});
function send(ws, type, data) {
    if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type, data }));
}
export function sendToUuid(uuid, type, data) {
    const ws = clients[uuid]?.ws;
    if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type, data }));
}
function broadcast(type, data) {
    for (const uuid in clients)
        send(clients[uuid].ws, type, data);
}
export function getClients() {
    return { clients, clientsNumber };
}
async function closeServer() {
    closing = true;
    await handleCloseServer();
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
            readline.clearLine(process.stdout, 0);
            process.exit(0);
        });
    });
}
const commands = {
    start: startGame,
    stop: () => endGame(true),
    skip: () => nextMove(true),
    exit: closeServer,
    termite: () => process.exit(0),
    say: (args) => {
        if (!args)
            return log('🚫 Пустое сообщение!');
        log('📢 Сообщение игрокам:', args);
        broadcast('say', { msg: args });
    },
    cls: () => console.clear(),
    memory: () => {
        pidusage(process.pid)
            .then((stat) => {
            const mem = process.memoryUsage();
            const fmt = (val) => val > 1024 * 1024
                ? (val / 1024 / 1024).toFixed(1).padStart(6) + ' MB'
                : (val / 1024).toFixed(1).padStart(6) + ' KB';
            log('\n📟 Ресурсы сервера:');
            log(`• ⏱️ Uptime:         ${(stat.elapsed / 1000).toFixed(2).padStart(5)} sec`);
            log(`• 🧠 CPU:            ${stat.cpu.toFixed(1).padStart(5)} %`);
            log(`• 👥 Подключений:    ${clientsNumber.toString().padStart(5)}\n`);
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
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🖥️>  ',
});
rl.prompt();
export function log(...args) {
    const line = rl.line;
    const pos = rl.cursor;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(...args);
    rl.prompt(true);
    rl.write(null, { ctrl: true, name: 'u' });
    rl.write(line);
    const offset = line.length - pos;
    if (offset > 0)
        readline.moveCursor(process.stdout, -offset, 0);
}
export function warn(...args) {
    log('⚠️', ...args);
}
export function error(...args) {
    log('❌', ...args);
}
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
    const nets = os.networkInterfaces();
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
