// game.ts
export {};

import { WebSocket } from 'ws';

import { Client, closing, getClients, log, sendToUuid } from './main.js';
import { skip } from 'node:test';

type Player = {
    uuid: string;
    index: number;
    cards: string[];
    usedCards: string[];
    sum: number;
};

const players: Player[] = [];

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

let maxPlayerNumber = 10;
let minSum = 12;

let sumLimit = 12;

let isGameRunning = false;
let cards: string[] = [];
let sum = 0;
let startIndex = -1;
let moveIndex = -1;

let cardsInHand = 4;

export function applyConfig(config: any) {
    const { maxPlayerNumber: _maxPlayerNumber, minSum: _minSum, cardsInHand: _cardsInHand } = config.game;
    if (_maxPlayerNumber && _maxPlayerNumber > 1) maxPlayerNumber = _maxPlayerNumber;
    if (_minSum && _minSum > 1) minSum = _minSum;
    if (_cardsInHand && cardsInHand > 3) cardsInHand = _cardsInHand;
}

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
    } else handleSpecialCard(cardType, movedPlayer, target);

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

// export function changeNickname(uuid: string, nickname: string) {
//     if (!isGameRunning) return;
//     let index = players.findIndex((pl) => pl.uuid === uuid);
//     if (index > -1) broadcast('nickname', { index, nickname });
// }

export function handleConnect(client: Client, reconnected: boolean) {
    let index = reconnected ? players.findIndex((pl) => pl.uuid === client.uuid) : players.length;
    if (isGameRunning && index === players.length) {
        client.ws.close(1001); // Игра уже идёт
        return false;
    }
    if (maxPlayerNumber <= players.length) {
        client.ws.close(1002); // Максимальное число игроков
        return false;
    }
    if (reconnected) {
        sendToUuid(client.uuid, 'start', {
            sumLimit,
            players: players.map((pl) => ({
                nickname: getClient(pl).nickname,
                cardsNumber: pl.cards.length,
                usedCards: pl.usedCards,
                sum: pl.sum,
            })),
        });
        sendToUuid(client.uuid, 'move', { index: moveIndex, skip: false });
    } else {
        players.push({ uuid: client.uuid, index, cards: [], usedCards: [], sum: 0 });
    }
    return true;
}

export function handleDisconnect(uuid: string, code: number) {
    let index = players.findIndex((pl) => pl.uuid === uuid);
    if (index < 0) return;
    players.splice(index, 1);
    if (isGameRunning) {
        broadcast('playerLeft', { index });
        if (players.length <= 1) endGame(true);
    }
}

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

export function nextMove(skip = false) {
    if (!isGameRunning) return;
    moveIndex = (moveIndex + 1) % players.length;
    broadcast('move', { index: moveIndex, skip });

    if (players[moveIndex].cards.length === 0) {
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

    log(`🎮 Ход игрока: ${getClient(players[moveIndex]).nickname}`);
}

function getClient(player: Player) {
    return getClients().clients[player.uuid];
}

function broadcast(type: string, data?: object) {
    for (const player of players) sendToUuid(player.uuid, type, data);
}

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
            // if (to.cards.length < from.cards.length) to.cards.push('0');
            sendToUuid(to.uuid, 'cards', { cards: to.cards });
        }
    }
}

function shuffleCards() {
    cards = [];

    for (const type in cardsTemplate) for (let i = 0; i < cardsTemplate[type]; i++) cards.push(type);

    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
}

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
