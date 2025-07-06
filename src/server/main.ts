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
    disable: boolean;
};

const clients: Record<string, Client> = {};
let clientsNumber = 0;
export let serverClosing = false;

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

    res.cookie('uuid', uuid, { maxAge: 15768000000 });
    res.cookie('nickname', nickname, { maxAge: 15768000000 });

    log(`📡 ${nickname} ${ops.has(uuid) ? '(Оператор) ' : ''}подключается`);
    log(`   ${uuid}\n`);
    res.status(200).send();
});

// === 🔌 Обработка WebSocket-соединений ===
wss.on('connection', (ws) => {
    let client: Client;
    const authTimeout = setTimeout(() => ws.close(), 5000);

    ws.once('message', (data) => {
        clearTimeout(authTimeout);

        let payload;
        try {
            payload = JSON.parse(data.toString());
        } catch (err) {}
        const { uuid, nickname } = payload as { uuid?: string; nickname?: string };

        if (!uuid || !nickname) return ws.close();

        const reconnected = clients[uuid]?.disable ?? false;
        if (reconnected) clients[uuid].ws.close();
        else clientsNumber++;

        client = { uuid, ws, nickname, disable: false };

        let errorCode = handleConnect(client.uuid, reconnected);
        if (errorCode > 0) {
            error(`${client.nickname} не авторизуется!\n`);
            ws.close(errorCode);
            return;
        }

        clients[uuid] = client;

        if (reconnected) log(`🔁 ${client.nickname} перезаходит\n`);
        else log(`✅ ${client.nickname} авторизуется\n`);

        if (ops.has(uuid)) send(ws, 'op', { op: true });

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

        ws.on('close', (code) => {
            if (!client) return;
            if (code >= 4000) {
                error(`${client.nickname} отключается`);
                delete clients[client.uuid];
                clientsNumber--;
            } else {
                warn(`${client.nickname} вышел`);
                clients[client.uuid].disable = true;
                setTimeout(() => {
                    if (clients[client.uuid].disable) {
                        handleDisconnect(client.uuid, code);
                        warn(`${client.nickname} отключается`);
                        delete clients[client.uuid];
                        clientsNumber--;
                    }
                }, config.timeout);
            }
        });
    });
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

// === ⛔ Завершение сервера ===
async function closeServer() {
    serverClosing = true;
    await disconnectClients();

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

async function disconnectClients() {
    endGame(true);
    const _clients = Object.values(clients);
    if (_clients.length <= 0) return;
    log('🕓 Завершение соединений...');
    for (const client of _clients) {
        try {
            if (!client) continue;

            const ws = client.ws;
            if (ws?.readyState === WebSocket.OPEN) {
                ws.close(4000);
                await waitForClose(ws, 2000);
            }
        } catch (e) {
            error('Ошибка при закрытии соединения: ' + e);
        }
    }
}

function waitForClose(ws: WebSocket, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            ws.terminate?.();
            resolve();
        }, timeoutMs);

        ws.on('close', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

// === ⚙️ Конфигурация ===
const config = {
    saveClose: true,
    showDns: false,
    timeout: 1000,
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

let hasOpFile = fs.existsSync('ops.txt');
if (!hasOpFile) fs.writeFileSync('ops.txt', '', 'utf-8');
export const ops = new Set(hasOpFile ? fs.readFileSync('ops.txt', 'utf-8').trim().split(/\s+/) : []);

function applyConfig() {
    if (merge(config, fs.existsSync('config.json') ? JSON.parse(fs.readFileSync('config.json', 'utf-8')) : undefined)) {
        fs.writeFileSync('config.json', JSON.stringify(config, null, 4), 'utf-8');
    }

    if (config.saveClose) process.on('SIGINT', closeServer);
    else process.removeListener('SIGINT', closeServer);

    applyGameConfig(config);
}

function merge(target: any, source: any): boolean {
    if (!source || typeof source !== 'object') return true;
    let needUpdate = false;

    for (const key of Object.keys(target)) {
        if (!(key in source)) continue;

        const val = source[key];
        const orig = target[key];

        if (val == undefined || typeof orig !== typeof val) {
            if (val == undefined) needUpdate = true;
            continue;
        }

        if (typeof orig === 'object') {
            if (merge(orig, val)) needUpdate = true;
        } else target[key] = val;
    }
    return needUpdate;
}

applyConfig();

// === 💻 CLI Команды ===
const commands: Record<string, (args?: string) => void> = {
    help: () => {
        const descriptions: Record<string, string> = {
            start: '▶️ Начать игру',
            stop: '⏹️ Остановить игру',
            skip: '⏭️ Пропустить ход',
            exit: '❎ Завершить сервер',
            terminate: '💀 Аварийное завершение',
            say: '💬 Отправить сообщение игрокам',
            cls: '🧹 Очистить консоль',
            list: '📋 Показать список подключений',
            config: '⚙️ Обновить конфигурацию',
            op: '🛡️ Сделать игрока оператором',
            deop: '🚫 Убрать оператора',
            memory: '📟 Показать использование памяти и ресурсов',
            net: '🔗 Показывает IP и DNS',
        };

        log('\n📖 Доступные команды:');
        for (const command of Object.keys(commands)) {
            if (command === 'help') continue;
            const desc = descriptions[command] || '—';
            log(`> ${command.padEnd(10)} ${desc}`);
        }
        log();
    },
    start: startGame,
    stop: () => endGame(true),
    skip: () => nextMove(true),
    exit: closeServer,
    terminate: () => {
        log('⚠️ Завершение работы сервера!');
        process.exit(0);
    },
    say: (args) => {
        if (!args) return log('🚫 Пустое сообщение!');
        log('📢 Сообщение игрокам:', args);
        broadcast('say', { msg: args });
    },
    cls: () => {
        console.clear();
        rl.prompt();
    },
    list: () => {
        if (!clientsNumber) return warn('Нет подключений!');
        log('📋 Список подключений:');
        log('   Имя              UUID                                   WS');
        log('───────────────────────────────────────────────────────────────');
        for (const uuid in clients) {
            let nickname = clients[uuid].nickname;
            nickname = nickname.length > 16 ? nickname.slice(0, 16) : nickname.padEnd(16);
            log(
                `${ops.has(uuid) ? '🛡️' : '🙂'} ${nickname} ${uuid.padEnd(38)} ${
                    clients[uuid].ws.readyState === WebSocket.OPEN ? '✅' : '❌'
                }`,
            );
        }
        log();
    },
    config: () => {
        log('⚙️ Применение конфига');
        applyConfig();
    },
    op: (arg) => {
        const uuid: string | undefined = arg?.trim();
        if (!uuid) return log('🚫 Пустое UUID!');
        if (ops.has(uuid)) return log('⛔ Уже оператор!');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid))
            return log('❌ Неверный UUID!');
        ops.add(uuid);
        fs.writeFileSync('ops.txt', [...ops].join(' '), 'utf-8');
        sendToUuid(uuid, 'op', { op: true });
        log('✅ Добавлен оператор');
    },
    deop: (arg) => {
        const uuid: string | undefined = arg?.trim();
        if (!uuid) return log('🚫 Пустое UUID!');
        if (!ops.has(uuid)) return log('⛔ Уже не оператор!');
        ops.delete(uuid);
        fs.writeFileSync('ops.txt', [...ops].join(' '), 'utf-8');
        sendToUuid(uuid, 'op', { op: false });
        log('✅ Убран оператор');
    },
    oplist: () => {
        if (ops.size === 0) return log('🛡️ Список операторов пуст');
        log('🛡️ Список операторов:');
        for (const uuid of ops) log(`🔑 ${uuid} — ${clients[uuid]?.nickname ?? 'не в сети'}`);
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
    net: showIPandDNS,
};

// === 🚀 Запуск сервера ===
let PORT = -1;

async function tryListen(port: number): Promise<number> {
    return new Promise((resolve) => {
        const testServer = createServer();
        testServer.once('error', (err) => resolve(-1));
        testServer.once('listening', () => {
            testServer.close();
            resolve(port);
        });
        testServer.listen(port);
    });
}

async function findFreePort(): Promise<number> {
    for (let port = 8080; port <= 8999; port++) if ((await tryListen(port)) !== -1) return port;
    return -1;
}

async function startServer() {
    PORT = await findFreePort();
    if (PORT === -1) {
        console.error('❌ Нет свободного порта в диапазоне 8080–8999.');
        process.exit(1);
    }

    server.listen(PORT, showIPandDNS);
}

startServer();

// === 🌍 IP & DNS ===
async function showIPandDNS() {
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

    if (config.showDns) {
        log();
        logReverseDNS();
    }
}

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
