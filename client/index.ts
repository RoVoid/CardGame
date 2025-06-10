let myUuid = '';
let myNickname = '';
let cards: string[] = [];
let moveUUID = '';
let sum = 0;
let maxSum = 12;

let timer: NodeJS.Timeout | null = null;

const nicknameInput = document.getElementById('nickname')! as HTMLInputElement;
nicknameInput.addEventListener('change', function () {
    myNickname = this.value.trim();
    if (this.value) send('nickname', { nickname: myNickname });
});
window.onload = () => nicknameInput.focus();

const gameElement = document.getElementById('game')!;

const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProtocol}://${location.host}`);

ws.addEventListener('open', () => {
    console.log('🟢 Подключено к серверу');
});

ws.addEventListener('message', (event) => {
    try {
        const { type, data } = JSON.parse(event.data);

        switch (type) {
            case 'index':
                myUuid = data.uuid;
                myNickname = data.nickname;
                nicknameInput.placeholder = myNickname;
                nicknameInput.value = '';
                console.log(`🆔 UUID: ${myUuid}`);
                break;

            case 'say':
                showMessage(data.msg);
                break;

            case 'stats':
                if (data.cards !== undefined) cards = data.cards;
                if (data.sum !== undefined) sum = data.sum;
                nicknameInput.style.display = 'none';
                gameElement.style.display = '';
                renderHand();
                break;

            case 'gameStats':
                if (data.maxSum) maxSum = data.maxSum;
                moveUUID = data.moveUUID;
                document.getElementById('sum')!.textContent = `Сумма ${calculateSum(data.players)} / ${maxSum}`;
                renderPlayers(data.players);
                break;

            case 'loser':
                setTimeout(() => {
                    nicknameInput.placeholder = myNickname;
                    nicknameInput.value = '';
                    nicknameInput.style.display = '';
                    gameElement.style.display = 'none';
                }, showMessage(data ? (data.uuid === myUuid ? `😭 Игра окончена! Вы проигрываете! 💔` : `🎉 Игра окончена! ${data.nickname} проигрывает! 😎👌🔥`) : '🛑 Игра отменена!') + 1000);
                break; // Ошибка: "Вы проигрываете!" выходит на одну секунду!

            case 'playerLeft':
                showMessage(`🚪 ${data.nickname} вышел`);
                break;

            case 'error':
                showMessage('Ошибка: ' + data.msg);
                break;

            default:
                console.warn('❓ Неизвестный тип:', type, data);
        }
    } catch (e) {
        console.error('❌ Ошибка обработки сообщения:', e);
    }
});

ws.addEventListener('close', (event) => {
    const { code } = event;
    if (code >= 1000 && code <= 1002) {
        const reason = ['❌ Сервер завершил работу!', '🛑 Игра уже началась!', '🚫 Нет мест!'][code - 1000];
        if (gameElement.style.display !== 'none') {
            nicknameInput.style.display = 'none';
            gameElement.style.display = 'none';
            showMessage(reason);
        } else
            setTimeout(() => {
                nicknameInput.style.display = 'none';
                gameElement.style.display = 'none';
            }, showMessage(reason) + 2500);
    }
    console.log('🔴 Соединение закрыто');
});

ws.addEventListener('error', () => {
    console.log('⚠️ Ошибка соединения');
});

function send(type: string, data: any = {}) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, data }));
    }
}

function renderHand() {
    const handDiv = document.getElementById('cards')!;
    handDiv.innerHTML = '';
    for (const card of cards) {
        const div = document.createElement('div');
        div.className = 'card';
        div.setAttribute('type', card);
        div.onclick = () => tryUseCard(div, card);
        handDiv.appendChild(div);
    }
}

function renderPlayers(players: any[]) {
    const panel = document.getElementById('players')!;
    panel.innerHTML = '';

    const index = players.findIndex((pl) => pl.uuid === myUuid);
    players = players.slice(index).concat(players.slice(0, index));
    for (const pl of players) {
        const container = document.createElement('div');
        container.className = 'player';
        container.id = `player-${pl.uuid}`;
        if (pl.uuid === moveUUID) container.style.border = '2px solid green';

        const title = document.createElement('span');
        title.textContent = `${pl.nickname}  /  ${pl.sum}`;
        container.appendChild(title);

        if (pl.uuid !== myUuid) {
            const hand = document.createElement('div');
            hand.className = 'cards';
            for (let i = 0; i < pl.count; i++) {
                const card = document.createElement('div');
                card.className = 'card';
                card.setAttribute('type', 'hidden');
                hand.appendChild(card);
            }
            container.appendChild(hand);
        }

        const used = document.createElement('div');
        used.className = 'used-cards';
        for (const usedCard of pl.usedCards) {
            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('type', usedCard);
            used.appendChild(card);
        }
        if (pl.usedCards.length) {
            const c = pl.usedCards.length;
            let gap = c <= 4 ? 5 : c >= 10 ? -40 : 5 + ((c - 4) / 6) * -45; //((c - 4) / (10 - 4)) * (-20 - 5);
            used.style.setProperty('--gap', `${gap}px`);
        }
        container.appendChild(used);

        container.onclick = () => selectTarget(pl.uuid);
        panel.appendChild(container);
    }
}

let selectedCardDiv: HTMLDivElement | null = null;
let selectedCard: string | null = null;
function tryUseCard(div: HTMLDivElement, card: string) {
    if (moveUUID === myUuid && card) {
        if (['0', '1', '2', '3', '4'].includes(card)) {
            send('use', { cardType: card, targetUUID: myUuid });
            hideMessage();
        } else {
            if (selectedCardDiv && selectedCardDiv !== div) selectedCardDiv.removeAttribute('selected');
            selectedCardDiv = div;
            selectedCard = card;
            selectedCardDiv?.toggleAttribute('selected');
            showMessage('Выберите цель, кликнув на игрока (можно себя)');
        }
    }
}

function selectTarget(targetUUID: string) {
    if (!selectedCard || moveUUID !== myUuid) return;
    send('use', { cardType: selectedCard, targetUUID });
    selectedCardDiv?.removeAttribute('selected');
    selectedCardDiv = null;
    selectedCard = null;
    hideMessage();
}

function calculateSum(players: any[]): number {
    return players.reduce((acc, p) => acc + (p.sum || 0), 0);
}

function showMessage(msg: string) {
    const el = document.getElementById('msg-block')!;
    el.textContent = msg;
    el.style.display = 'block';
    el.classList.add('visible');

    const duration = Math.min(Math.max(2000, msg.length * 100), 10000);
    timer = setTimeout(() => {
        el.classList.remove('visible');
        el.addEventListener(
            'transitionend',
            () => {
                el.style.display = 'none';
                el.textContent = '';
            },
            { once: true },
        );
    }, duration);

    return duration;
}

function hideMessage() {
    if (timer) clearTimeout(timer);
    timer = null;
    const el = document.getElementById('msg-block')!;
    el.classList.remove('visible');
    el.addEventListener(
        'transitionend',
        () => {
            el.style.display = 'none';
            el.textContent = '';
        },
        { once: true },
    );
}
