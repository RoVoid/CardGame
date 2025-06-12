// main.ts
export {};

// === 📦 Импорты ===
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
import dns from 'dns';
import https from 'https';

import {
    applyGameConfig,
    endGame,
    handleConnect,
    handleDisconnect,
    handleCardUse,
    startGame,
    handleCloseServer,
    nextMove,
    requestToStart,
} from './game.js';

// === ⚙️ Настройка Express и WebSocket ===
const app = express();
app.use(cookieParser());

const server = createServer(app);
const wss = new WebSocketServer({ server });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../client')));

export type Client = {
    uuid: string;
    ws: WebSocket;
    nickname: string;
};

const clients: Record<string, Client> = {};
let clientsNumber = 0;
export let closing = false;

// === 🍪 Обработка /cookies ===
app.get('/cookies', (req, res) => {
    let { uuid, nickname } = req.cookies as { uuid?: string; nickname?: string };

    if (!uuid) {
        uuid = randomUUID();
        res.cookie('uuid', uuid, { httpOnly: false, sameSite: 'lax', path: '/' });
    }
    if (!nickname) {
        nickname = 'Игрок ' + clientsNumber;
        res.cookie('nickname', nickname, { httpOnly: false, sameSite: 'lax', path: '/' });
    }

    log(`📡 ${nickname} ${ops.includes(uuid) ? '(Оператор) ' : ''}подключается`);
    log(`   ${uuid}\n`);
    res.status(200).send();
});

// === 🔌 Обработка WebSocket-соединений ===
wss.on('connection', (ws) => {
    let client: Client;

    ws.once('message', (data) => {
        const { uuid, nickname } = JSON.parse(data.toString()) as { uuid?: string; nickname?: string };

        if (!uuid || !nickname) return ws.close();

        const reconnected = clients[uuid] != undefined;
        if (reconnected) clients[uuid].ws?.close();
        else clientsNumber++;

        client = { uuid, ws, nickname };
        clients[uuid] = client;

        if (!handleConnect(client, reconnected)) {
            error(`${client.nickname} не авторизуется!\n`);
            return;
        }

        log(`✅ ${client.nickname} авторизуется\n`);

        ws.on('message', (rawData) => {
            try {
                const { type, data } = JSON.parse(rawData.toString()) as { type: string; data?: any };
                if (!type) return;

                switch (type) {
                    case 'start':
                        requestToStart(client.uuid);
                        break;
                    case 'nickname': {
                        const oldNickname = client.nickname;
                        client.nickname = data?.nickname?.trim().slice(0, 16) || client.nickname;
                        if (oldNickname !== client.nickname) log(`✏️ ${oldNickname} переименуется в ${client.nickname}`);
                        send(ws, type, { nickname: client.nickname });
                        break;
                    }
                    case 'use':
                        handleCardUse(client.uuid, data?.cardType, data?.targetIndex);
                        break;
                    default:
                        warn(`Неизвестное сообщение от ${client.nickname}: (${type})\n${JSON.stringify(data)}`);
                }
            } catch (e) {
                error('Ошибка:', e);
            }
        });
    });

    ws.on('close', (code) => {
        if (!client) return;
        delete clients[client.uuid];
        if (closing) error(`${client.nickname} отключился`);
        else
            setTimeout(() => {
                if (!clients[client.uuid]) {
                    handleDisconnect(client.uuid, code);
                    error(`${client.nickname} отключился`);
                    clientsNumber--;
                }
            }, 500);
    });

    function sendTo(type: string, data?: object) {
        send(ws, type, data);
    }
});

// === 📡 Коммуникация ===
function send(ws: WebSocket, type: string, data?: object) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data }));
}

export function sendToUuid(uuid: string, type: string, data?: object) {
    const ws = clients[uuid]?.ws;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data }));
}

function broadcast(type: string, data?: object) {
    for (const uuid in clients) send(clients[uuid].ws, type, data);
}

export function getClients() {
    return { clients, clientsNumber };
}

// === ⛔ Завершение сервера ===
async function closeServer() {
    closing = true;
    await handleCloseServer();

    wss.close((err) => {
        if (err) log('🛑 Принудительная остановка WebSocket сервера!');
        else log('✅ WebSocket сервер завершён');

        server.close((err) => {
            if (err) log('🛑 Принудительная остановка HTTP сервера!');
            else log('✅ HTTP сервер завершён');

            readline.clearLine(process.stdout, 0);
            process.exit(0);
        });
    });
}

// === ⚙️ Конфигурация ===
const config: any = {};
export const ops: string[] = [];

function applyConfig() {
    if (!fs.existsSync('config.json')) {
        const template = {
            ops: [],
            saveClose: true,
            game: {
                maxPlayerNumber: 10,
                minSum: 12,
                cardsInHand: 4,
                cards: {
                    '0': 10,
                    '1': 10,
                    '2': 10,
                    '3': 10,
                    '4': 3,
                    plus: 3,
                    bin: 3,
                    swap: 3,
                },
            },
        };
        fs.writeFileSync('config.json', JSON.stringify(template, null, 4), 'utf-8');
        log('📄 Создан шаблон config.json');
    }

    Object.assign(config, JSON.parse(fs.readFileSync('config.json', 'utf-8')));
    ops.length = 0;
    ops.push(...(config.ops || []));

    if (config.saveClose) process.on('SIGINT', closeServer);
    else process.removeListener('SIGINT', closeServer);

    applyGameConfig(config);
}

applyConfig();

// === 💻 CLI Команды ===
const commands: Record<string, (args?: string) => void> = {
    start: startGame,
    stop: () => endGame(true),
    skip: () => nextMove(true),
    exit: closeServer,
    termite: () => process.exit(0),
    say: (args) => {
        if (!args) return log('🚫 Пустое сообщение!');
        log('📢 Сообщение игрокам:', args);
        broadcast('say', { msg: args });
    },
    cls: () => console.clear(),
    list: () => {
        if (!clientsNumber) return warn('Нет подключений!');
        log('📋 Список подключений:');
        log(' Имя              UUID                                   WS');
        log('───────────────────────────────────────────────────────────────');
        for (const uuid in clients) {
            let nickname = clients[uuid].nickname;
            nickname = nickname.length > 16 ? nickname.slice(0, 16) : nickname.padEnd(16);
            log(` ${nickname} ${uuid.padEnd(37)} ${clients[uuid].ws.readyState === WebSocket.OPEN ? '✅' : '❌'}`);
        }
        log();
    },
    config: () => {
        log('⚙️ Применение конфига');
        applyConfig();
    },
    memory: () => {
        pidusage(process.pid)
            .then((stat) => {
                const mem = process.memoryUsage();
                const fmt = (val: number) =>
                    val > 1024 * 1024
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
            .catch((err) => error('❌ Ошибка получения ресурсов:', err));
    },
};

// === ⌨️ Интерфейс ввода (CLI) ===
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🖥️>  ',
});
rl.prompt();

rl.on('line', (input) => {
    const [cmd, ...rest] = input.trim().split(' ');
    const fn = commands[cmd];
    if (fn) fn(rest.join(' '));
    else log('❓ Неизвестная команда');
});

// === 📝 Логирование ===
export function log(...args: any[]) {
    const anyRl = rl as any;
    const line = anyRl.line;
    const pos = anyRl.cursor;

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(...args);

    rl.prompt(true);

    anyRl.line = line;
    anyRl.cursor = pos;
    anyRl._refreshLine();
}

export function warn(...args: any[]) {
    log('⚠️', ...args);
}

export function error(...args: any[]) {
    log('❌', ...args);
}

// === 🚀 Запуск сервера ===
const PORT = 8080;
server.listen(PORT, () => {
    log(`🚀 Сервер запущен на:`);
    log(`  💻 http://localhost:${PORT}`);

    const nets = os.networkInterfaces();
    for (const name in nets) {
        for (const net of nets[name]!) {
            if (net.family === 'IPv4' && !net.internal) {
                const addr = net.address;
                const emoji = addr.startsWith('192.') || addr.startsWith('10.') || addr.startsWith('172.') ? '🏠' : '🌐';
                log(`  ${emoji} http://${addr}:${PORT}`);
            }
        }
    }

    log();
    logReverseDNS();
});

// === 🌍 Обратный DNS ===
function getPublicIP(): Promise<string> {
    return new Promise((resolve, reject) =>
        https
            .get('https://api.ipify.org', (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => resolve(data.trim()));
            })
            .on('error', reject),
    );
}

async function logReverseDNS() {
    try {
        const ip = await getPublicIP();
        dns.reverse(ip, (err, hostnames) => {
            if (err) warn(`Обратный DNS не найден для ${ip}`);
            else for (const name of hostnames) log(`🌍 DNS-домен: http://${name}:${PORT}`);
        });
    } catch {
        error(`Не удалось получить внешний IP`);
    }
}
