export {};

// Cookies
await fetch('/cookies', { method: 'GET', credentials: 'include' });

function getCookie(name: string) {
    const match = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
    return match ? decodeURIComponent(match[2]) : '';
}

function setCookie(name: string, value: string, days?: number) {
    const expires = days ? '; max-age=' + days * 24 * 60 * 60 : '';
    document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/`;
    console.log(name, value);
}

// Variables
let myUuid = getCookie('uuid');
let myNickname = getCookie('nickname');
let cards: string[] = [];
let myIndex = -1;
let moveIndex = -1;
let sumLimit = 12;
let sum = 0;
let timer: NodeJS.Timeout | null = null;

type Player = {
    index: number;
    nickname: string;
    cardsNumber: number;
    usedCards: string[];
    sum: number;
};

let players: Player[] = [];
let selectedCardDiv: HTMLDivElement | null = null;
let selectedCard: string | null = null;

// DOM Elements
const nicknameInput = document.getElementById('nickname')! as HTMLInputElement;
const lobbyElement = document.getElementById('lobby')!;
const gameElement = document.getElementById('game')!;
const playersElement = document.getElementById('players')!;
const handDiv = document.getElementById('cards')!;
const endAudio = new Audio('./assets/end.mp3');
const moveAudio = new Audio('./assets/move.mp3');

// Tooltip Descriptions
const tooltips: Record<string, string> = {
    '0': 'Карточка с суммой = 0',
    '1': 'Карточка с суммой = 1',
    '2': 'Карточка с суммой = 2',
    '3': 'Карточка с суммой = 3',
    '4': 'Карточка с суммой = 4',
    plus: 'Карточка с суммой = 1. Увеличивает стоимость карт игрока на 1, 3 переходит в 0. Не действует на <span style="color:#151515">#000</span> карты и на игрока без карт!',
    bin: 'Удаляет все выложенные карты игрока!',
    swap: 'Меняет карты на руках с другим игроком. Не действует на игрока без карт!',
};

// Setup
window.onload = () => nicknameInput.focus();
nicknameInput.placeholder = myNickname;
nicknameInput.addEventListener('change', function () {
    myNickname = this.value.trim();
    if (this.value) send('nickname', { nickname: myNickname });
});

playersElement.addEventListener(
    'wheel',
    (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            playersElement.scrollLeft += e.deltaY / 2;
        }
    },
    { passive: false },
);

document.addEventListener('click', unlockAudio);
function unlockAudio() {
    moveAudio.muted = true;
    moveAudio.play().finally(() => {
        moveAudio.pause();
        moveAudio.currentTime = 0;
        moveAudio.muted = false;
    });
    document.removeEventListener('click', unlockAudio);
}

console.log(`🆔 UUID: ${myUuid}`);
console.log(`   Nickname: ${myNickname}`);

// WebSocket
const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProtocol}://${location.host}`);

ws.addEventListener('open', () => {
    console.log('🟢 Подключено к серверу');
    ws.send(JSON.stringify({ uuid: myUuid, nickname: myNickname }));
});

ws.addEventListener('message', (event) => {
    try {
        const { type, data } = JSON.parse(event.data) as { type: string; data: any };
        switch (type) {
            case 'op':
                const startButton = document.getElementById('start')!;
                if (startButton.style.display !== 'none') return;
                startButton.style.display = '';
                startButton.addEventListener('click', () => send('start'));
                break;

            case 'nickname':
                const filtered = data.nickname || myNickname;
                if (lobbyElement.style.display !== 'none') {
                    nicknameInput.placeholder = nicknameInput.value = filtered;
                    nicknameInput.style.animation = 'none';
                    nicknameInput.offsetHeight;
                    nicknameInput.style.animation = (myNickname === filtered ? 'nickAccept' : 'nickReject') + ' 0.5s 1';
                }
                myNickname = filtered;
                setCookie('nickname', myNickname);
                console.log(`✏️ Nickname: ${myNickname}`);
                break;

            case 'say':
                showMessage(data.msg);
                break;

            case 'cards':
                if (data.cards !== undefined) cards = data.cards;
                renderHand();
                break;

            case 'index':
                myIndex = data.index;
                console.log(`🆔 Index: ${myIndex}`);
                break;

            case 'start':
                lobbyElement.style.display = 'none';
                gameElement.style.display = '';
                sumLimit = data.sumLimit;
                players = data.players;
                document.getElementById('sum')!.textContent = `Сумма 0 / ${sumLimit}`;
                sum = 0;
                moveIndex = -1;
                renderPlayers();
                break;

            case 'move':
                if (moveIndex > -1) {
                    document.getElementById('player' + moveIndex)?.removeAttribute('selected');
                    document.getElementById('player' + ((moveIndex + 1) % players.length))?.removeAttribute('next');
                    if (!data.skip) moveAudio.play();
                }
                moveIndex = data.index;
                document.getElementById('player' + moveIndex)?.toggleAttribute('selected');
                document.getElementById('player' + ((moveIndex + 1) % players.length))?.toggleAttribute('next');
                break;

            case 'player':
                const index = data.index;
                if (index < 0 || index >= players.length) return;

                sum -= players[index].sum;
                sum += players[index].sum = data.sum;

                document.getElementById('sum')!.textContent = `Сумма ${sum} / ${sumLimit}`;
                players[index].cardsNumber = data.cardsNumber;
                players[index].usedCards = data.usedCards;
                updatePlayer(index);
                break;

            case 'playerLeft':
                const leaveIndex = data.index;
                if (leaveIndex < 0 || leaveIndex >= players.length) return;

                document.getElementById('player' + leaveIndex)?.remove();
                for (let i = leaveIndex + 1; i < players.length; i++) {
                    document.getElementById('player' + i)!.id = 'player' + (i - 1);
                }

                sum -= players[leaveIndex].sum;
                document.getElementById('sum')!.textContent = `Сумма ${sum} / ${sumLimit}`;

                showMessage(`🚪 ${players[leaveIndex].nickname} выходит`);
                players.splice(leaveIndex, 1);
                break;

            case 'loser':
                setTimeout(() => {
                    nicknameInput.placeholder = myNickname;
                    nicknameInput.value = '';
                    lobbyElement.style.display = '';
                    gameElement.style.display = 'none';
                }, showMessage(data ? (data.uuid === myUuid ? `😭 Игра окончена! Вы проигрываете! 💔` : `🎉 Игра окончена! ${data.nickname} проигрывает! 😎👌🔥`) : '🛑 Игра отменена!') + 1000);
                if (data) endAudio.play();
                break;

            case 'error':
                showMessage('❌ Ошибка: ' + data.msg);
                break;

            default:
                console.warn('❓ Неизвестный тип:', type, data);
        }
    } catch (e) {
        console.error('❌ Ошибка обработки сообщения:', e);
    }
});

ws.addEventListener('close', ({ code }) => {
    if (code >= 1000 && code <= 1002) {
        const reason = ['❌ Сервер завершил работу!', '🛑 Игра уже началась!', '🚫 Нет мест!'][code - 1000];
        if (gameElement.style.display !== 'none') {
            lobbyElement.style.display = 'none';
            gameElement.style.display = 'none';
            showMessage(reason);
        } else {
            setTimeout(() => {
                lobbyElement.style.display = 'none';
                gameElement.style.display = 'none';
            }, showMessage(reason) + 1000);
        }
    }
    console.log('🔴 Соединение закрыто');
});

ws.addEventListener('error', () => console.log('⚠️ Ошибка соединения'));

// Utility
function send(type: string, data: any = {}) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data }));
}

function showMessage(msg: string) {
    const el = document.getElementById('msg-block')!;
    el.textContent = msg;
    el.classList.add('visible');
    const duration = Math.min(Math.max(2000, msg.length * 100), 10000);
    timer = setTimeout(() => el.classList.remove('visible'), duration);
    return duration;
}

function hideMessage() {
    if (timer) clearTimeout(timer);
    timer = null;
    document.getElementById('msg-block')!.classList.remove('visible');
}

// UI
function renderHand() {
    handDiv.innerHTML = '';
    for (const card of cards) {
        const div = document.createElement('div');
        div.className = 'card';
        div.setAttribute('type', card);
        div.onclick = () => tryUseCard(div, card);
        const tooltip = document.createElement('span');
        tooltip.className = 'tooltip';
        tooltip.innerHTML = tooltips[card];
        div.appendChild(tooltip);
        handDiv.appendChild(div);
    }
}

function renderPlayers() {
    const panel = playersElement;
    panel.innerHTML = '';
    const _players = players.slice(myIndex).concat(players.slice(0, myIndex));
    for (const player of _players) {
        const container = document.createElement('div');
        container.className = 'player';
        container.id = `player${player.index}`;

        const title = document.createElement('span');
        title.textContent = `${player.nickname}  /  ${player.sum}`;
        container.appendChild(title);

        if (player.index !== myIndex) {
            const hand = document.createElement('div');
            hand.className = 'cards';
            for (let i = 0; i < player.cardsNumber; i++) {
                const card = document.createElement('div');
                card.className = 'card';
                card.setAttribute('type', 'hidden');
                hand.appendChild(card);
            }
            container.appendChild(hand);
        }

        const used = document.createElement('div');
        used.className = 'used-cards';
        if (player.usedCards.length) {
            for (const usedCard of player.usedCards) {
                const card = document.createElement('div');
                card.className = 'card';
                card.setAttribute('type', usedCard);
                used.appendChild(card);
            }
            let gap =
                player.usedCards.length <= 4
                    ? 5
                    : player.usedCards.length >= 10
                    ? -40
                    : 5 + ((player.usedCards.length - 4) / 6) * -45;
            used.style.setProperty('--gap', `${gap}px`);
        }
        container.appendChild(used);
        container.onclick = () => selectTarget(player.index);
        panel.appendChild(container);
    }
}

function updatePlayer(index: number) {
    const container = document.getElementById('player' + index);
    if (!container) return;

    container.querySelector('span')!.textContent = `${players[index].nickname}  /  ${players[index].sum}`;

    if (index !== myIndex) {
        const hand = container.querySelector('.cards')!;
        hand.innerHTML = '';
        for (let i = 0; i < players[index].cardsNumber; i++) {
            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('type', 'hidden');
            hand.appendChild(card);
        }
    }

    const used = container.querySelector('.used-cards')! as HTMLElement;
    used.innerHTML = '';
    const count = players[index].usedCards.length;
    if (count) {
        for (const usedCard of players[index].usedCards) {
            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('type', usedCard);
            used.appendChild(card);
        }
        let gap = count <= 4 ? 5 : count >= 10 ? -40 : 5 + ((count - 4) / 6) * -45;
        used.style.setProperty('--gap', `${gap}px`);
    }
}

function tryUseCard(div: HTMLDivElement, card: string) {
    if (moveIndex !== myIndex || !card) return;
    if (['0', '1', '2', '3', '4'].includes(card)) {
        send('use', { cardType: card, targetIndex: myIndex });
        hideMessage();
    } else {
        if (selectedCardDiv && selectedCardDiv !== div) selectedCardDiv.removeAttribute('selected');
        selectedCardDiv = div;
        selectedCard = card;
        selectedCardDiv?.toggleAttribute('selected', true);
        showMessage('Выберите цель, кликнув на игрока (можно себя)');
    }
}

function selectTarget(targetIndex: number) {
    if (!selectedCard || moveIndex !== myIndex) return;
    send('use', { cardType: selectedCard, targetIndex });
    selectedCardDiv?.removeAttribute('selected');
    selectedCardDiv = null;
    selectedCard = null;
    hideMessage();
}
