const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors({ origin: '*' })); // Разрешаем запросы от расширения
app.use(express.json());

// Хранилище удаленных сообщений (в памяти, для продакшена нужна БД)
const deletedMessagesStore = new Map();

// Декодер бомб (как в allinoneAAA.txt)
const INVISIBLE_CHARS = " \u200b\u200c\u200f\u202f⁪⁫⁬⁮⁯";
function decodeBomb(text) {
    if (!text) return text;
    const regex = /[ \u2002]([ \u200b\u200c\u200f\u202f⁫⁬⁭⁮⁯]+)(?= |$)/g;
    const matches = text.match(regex);
    if (!matches) return text;
    let decodedBytes = [];
    for (let match of matches) {
        const cleanMatch = match.replace(/^[ \u2002]/, '');
        let num = 0;
        for (let i = 0; i < cleanMatch.length; i++) {
            const pos = cleanMatch.length - i - 1;
            const charIndex = INVISIBLE_CHARS.indexOf(cleanMatch.substring(pos, pos + 1));
            if (charIndex !== -1) num += charIndex * Math.pow(INVISIBLE_CHARS.length, i);
        }
        decodedBytes.push(num);
    }
    try { return new TextDecoder("utf-8").decode(new Uint8Array(decodedBytes)); } 
    catch (e) { return text; }
}

// Эндпоинт для получения токена и запуска LP
app.post('/api/vke/init', async (req, res) => {
    const { token, userId } = req.body;
    if (!token) return res.status(400).json({ error: 'No token' });
    
    // Запускаем LP для этого пользователя (в реальном проекте нужен менеджер сессий)
    startLongPoll(token, userId);
    res.json({ status: 'ok' });
});

// Эндпоинт для получения истории удаленных
app.get('/api/vke/history/:peerId', (req, res) => {
    const peerId = req.params.peerId;
    const history = deletedMessagesStore.get(peerId) || [];
    // Сортируем по времени
    history.sort((a, b) => a.date - b.date);
    res.json(history);
});

// Функция запуска Long Poll
async function startLongPoll(token, userId) {
    try {
        const serverData = await axios.post('https://api.vk.com/method/messages.getLongPollServer', null, {
            params: { access_token: token, v: '5.199', lp_version: 3 }
        });
        
        const { server, key, ts } = serverData.data.response;
        console.log(`[SERVER] LP started for user ${userId}`);
        
        pollLoop(server, key, ts, token, userId);
    } catch (e) {
        console.error('[SERVER] LP Init Error:', e.message);
    }
}

async function pollLoop(server, key, ts, token, userId) {
    try {
        const response = await axios.get(`https://${server}`, {
            params: { act: 'a_check', key, ts, wait: 25, mode: 1226, version: 3 }
        });
        
        const data = response.data;
        if (data.failed) {
            console.log('[SERVER] LP Failed, restarting...');
            startLongPoll(token, userId);
            return;
        }
        
        ts = data.ts;
        if (data.updates) {
            for (const update of data.updates) {
                // Код 4 - новое сообщение, Код 2/3 - флаги (удаление)
                if (update[0] === 4 || update[0] === 2 || update[0] === 3) {
                    await processUpdate(update, token, userId);
                }
            }
        }
        
        // Рекурсивный вызов без задержки (LP сам ждет 25 сек)
        pollLoop(server, key, ts, token, userId);
    } catch (e) {
        console.error('[SERVER] Poll Error:', e.message);
        setTimeout(() => pollLoop(server, key, ts, token, userId), 5000);
    }
}

async function processUpdate(update, token, userId) {
    const [type, msgId, flags, minorId, peerId, date, text, extra] = update;
    const cmid = extra?.cmid || msgId;
    const isOutgoing = !!(flags & 2);
    const isDeleted = !!(flags & 128);
    
    // Если это удаление или новое сообщение
    if ((type === 2 && isDeleted) || type === 4) {
        let messageData = {
            id: String(cmid),
            peer_id: String(peerId),
            text: text || '',
            date: date,
            from_id: extra?.from || (isOutgoing ? userId : peerId),
            is_deleted: true,
            is_bomb: /[\u200b\u200c\u200f\u202f⁪⁫⁬⁮⁯]/.test(text || '')
        };

        // Если текста нет или это удаление, пробуем получить полные данные
        if (!text || isDeleted) {
            try {
                const apiRes = await axios.post('https://api.vk.com/method/messages.getById', null, {
                    params: { access_token: token, v: '5.199', message_ids: msgId, extended: 1 }
                });
                
                const item = apiRes.data.response?.items?.[0];
                if (item) {
                    messageData.text = item.text || messageData.text;
                    messageData.from_id = item.from_id;
                    messageData.date = item.date;
                    
                    // Получаем имя и аватарку из profiles/groups
                    const profile = apiRes.data.response.profiles?.find(p => p.id === item.from_id);
                    if (profile) {
                        messageData.authorName = `${profile.first_name} ${profile.last_name}`;
                        messageData.authorPhoto = profile.photo_100 || profile.photo_50;
                    }
                }
            } catch (e) {}
        }

        // Сохраняем в хранилище
        if (!deletedMessagesStore.has(String(peerId))) {
            deletedMessagesStore.set(String(peerId), []);
        }
        
        const peerHistory = deletedMessagesStore.get(String(peerId));
        const existingIndex = peerHistory.findIndex(m => m.id === String(cmid));
        
        if (existingIndex !== -1) {
            // Обновляем существующее
            peerHistory[existingIndex] = { ...peerHistory[existingIndex], ...messageData, is_deleted: true };
        } else {
            // Добавляем новое
            peerHistory.push(messageData);
        }
    }
}

app.listen(3000, () => console.log('[SERVER] VKE Server running on port 3000'));