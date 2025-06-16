// game.ts
export {};

import { WebSocket } from 'ws';
import { Client, closing, getClients, log, ops, sendToUuid } from './main.js';

type Player = {
    uuid: string;
    index: number;
    cards: string[];
    usedCards: string[];
    sum: number;
};

const allowedCardKeys = ['0', '1', '2', '3', '4', 'plus', 'bin', 'swap'];
const cardsTemplate: Record<string, number> = {
    '0': 10,
    '1': 10,
    '2': 10,
    '3': 10,
    '4': 3,
    plus: 3,
    bin: 3,
    swap: 3,
};

const players: Player[] = [];

let maxPlayerNumber = 10;
let minSum = 12;
let cardsInHand = 4;
let sumLimit = 12;
let isGameRunning = false;
let cards: string[] = [];
let sum = 0;
let startIndex = -1;
let moveIndex = -1;

/* === Конфигурация === */
export function applyGameConfig(config: any) {
    const { maxPlayerNumber: _max, minSum: _min, cardsInHand: _hand, cards: _cards } = config.game;

    if (_max && _max > 1) maxPlayerNumber = _max;
    if (_min && _min > 1) minSum = _min;
    if (_hand && _hand > 3) cardsInHand = _hand;

    if (_cards && typeof _cards === 'object') {
        for (const key of allowedCardKeys)
            if (typeof _cards[key] === 'number' && _cards[key] >= 0) cardsTemplate[key] = _cards[key];
    }
}

/* === Подключение игроков === */
export function handleConnect(client: Client, reconnected: boolean) {
    const index = reconnected ? players.findIndex((pl) => pl.uuid === client.uuid) : players.length;

    if (isGameRunning && index === players.length) {
        client.ws.close(1001);
        return false;
    }

    if (players.length >= maxPlayerNumber) {
        client.ws.close(1002);
        return false;
    }

    if (isGameRunning && reconnected) {
        sendToUuid(client.uuid, 'start', {
            sumLimit,
            players: players.map((pl) => ({
                nickname: getClient(pl).nickname,
                cardsNumber: pl.cards.length,
                usedCards: pl.usedCards,
                sum: pl.sum,
            })),
        });
        sendToUuid(client.uuid, 'index', { index });
        sendToUuid(client.uuid, 'move', { index: moveIndex, skip: false });
    } else {
        players.push({
            uuid: client.uuid,
            index,
            cards: [],
            usedCards: [],
            sum: 0,
        });
    }

    return true;
}

export function handleDisconnect(uuid: string, code: number) {
    const index = players.findIndex((pl) => pl.uuid === uuid);
    if (index < 0) return;

    players.splice(index, 1);

    if (isGameRunning) {
        broadcast('playerLeft', { index });
        if (players.length <= 1) endGame(true);
        else broadcast('move', { index: moveIndex, skip: true });
    }
}

/* === Запрос на старт от оператора === */
export function requestToStart(uuid: string) {
    if (ops.has(uuid)) startGame();
}

/* === Старт и завершение игры === */
export function startGame() {
    if (players.length < 2) return log('👥 Недостаточно игроков');
    if (isGameRunning) return log('⚠️ Игра уже начата');

    isGameRunning = true;
    sum = 0;
    sumLimit = Math.max(minSum, players.length * 4);

    for (const [i, player] of players.entries()) {
        player.cards = [];
        player.usedCards = [];
        player.sum = 0;
        sendToUuid(player.uuid, 'index', { index: i });
    }

    broadcast('start', {
        sumLimit,
        players: players.map((pl, index) => ({
            index,
            nickname: getClient(pl).nickname,
            cardsNumber: pl.cards.length,
            usedCards: pl.usedCards,
            sum: pl.sum,
        })),
    });

    moveIndex = startIndex;
    nextMove();
    startIndex = (startIndex + 1) % players.length;
}

export function endGame(force = false) {
    isGameRunning = false;

    if (force) {
        log(`🏁 Игра отмена!\n`);
        if (!closing) broadcast('loser');
    } else {
        const client = getClient(players[moveIndex]);
        broadcast('loser', { uuid: client.uuid, nickname: client.nickname });
        log(`🏁 Игра окончена! Проиграл ${client.nickname}\n`);
    }
}

/* === Следующий ход === */
export function nextMove(skip = false) {
    if (!isGameRunning) return;

    moveIndex = (moveIndex + 1) % players.length;
    broadcast('move', { index: moveIndex, skip });

    const current = players[moveIndex];

    if (current.cards.length === 0) {
        if (cards.length === 0) shuffleCards();

        for (const [i, player] of players.entries()) {
            while (player.cards.length < cardsInHand) {
                player.cards.push(cards.pop()!);
                if (cards.length === 0) shuffleCards();
            }

            sendToUuid(player.uuid, 'cards', { cards: player.cards });
            broadcast('player', {
                index: i,
                sum: player.sum,
                cardsNumber: player.cards.length,
                usedCards: player.usedCards,
            });
        }
    }

    log(`🎮 Ход игрока: ${getClient(current).nickname}`);
}

/* === Обработка карт === */
export function handleCardUse(uuid: string, cardType: string, targetIndex: number) {
    if (!cardType || targetIndex < 0 || targetIndex >= players.length) return;

    const movedPlayer = players[moveIndex];
    if (!isGameRunning || !movedPlayer || movedPlayer.uuid !== uuid) return;
    if (!movedPlayer.cards.includes(cardType)) return;

    const target = players[targetIndex];
    if (!target) return;

    const isNumber = ['0', '1', '2', '3', '4'].includes(cardType);
    if (
        (isNumber && target.uuid !== movedPlayer.uuid) ||
        (cardType !== 'bin' && target.cards.length === 0) ||
        (cardType === 'bin' && target.usedCards.length === 0)
    )
        return;

    movedPlayer.usedCards.push(cardType);
    movedPlayer.cards.splice(movedPlayer.cards.indexOf(cardType), 1);

    log(
        `🎴 ${getClient(movedPlayer).nickname} использует '${cardType}' ${
            targetIndex !== moveIndex ? `на ${getClient(target).nickname}` : ''
        }`,
    );

    if (isNumber) {
        const v = parseInt(cardType);
        sum += v;
        movedPlayer.sum += v;
    } else {
        handleSpecialCard(cardType, movedPlayer, target);
    }

    sendToUuid(movedPlayer.uuid, 'cards', { cards: movedPlayer.cards });
    broadcast('player', {
        index: moveIndex,
        sum: movedPlayer.sum,
        cardsNumber: movedPlayer.cards.length,
        usedCards: movedPlayer.usedCards,
    });

    if (sum > sumLimit) return endGame();
    nextMove();
}

/* === Обработка спецкарт === */
function handleSpecialCard(card: string, from: Player, to: Player) {
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
        if (changed) sendToUuid(to.uuid, 'cards', { cards: to.cards });
    } else if (card === 'bin') {
        sum -= to.sum;
        to.sum = 0;
        to.usedCards = [];
        broadcast('player', {
            index: to.index,
            sum: to.sum,
            cardsNumber: to.cards.length,
            usedCards: to.usedCards,
        });
    } else if (card === 'swap') {
        if (from.uuid !== to.uuid) {
            [from.cards, to.cards] = [to.cards, from.cards];
            sendToUuid(to.uuid, 'cards', { cards: to.cards });
        }
    }
}

/* === Вспомогательные функции === */
function shuffleCards() {
    cards = [];

    for (const type in cardsTemplate) {
        for (let i = 0; i < cardsTemplate[type]; i++) {
            cards.push(type);
        }
    }

    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
}

function getClient(player: Player) {
    return getClients().clients[player.uuid];
}

function broadcast(type: string, data?: object) {
    for (const player of players) {
        sendToUuid(player.uuid, type, data);
    }
}

/* === Завершение сервера === */
export async function handleCloseServer() {
    if (isGameRunning) endGame(true);
    if (players.length) log('🕓 Завершение соединений...');

    for (const player of players) {
        try {
            const client = getClient(player);
            if (!client) continue;

            const ws = client.ws;
            if (ws?.readyState === WebSocket.OPEN) {
                ws.close(1000);
                await waitForClose(ws, 2000);
            }
        } catch (e) {
            log('Ошибка при закрытии соединения: ' + e);
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
