const APP_ID = 6287487; // ID официального приложения VK (как у VK Next)

async function startAuth() {
    const btn = document.getElementById('authBtn');
    const status = document.getElementById('status');
    const desc = document.getElementById('desc');
    
    btn.disabled = true;
    btn.innerText = 'Получение токена...';
    status.innerText = '';
    status.className = 'status';

    try {
        // Запрос к login.vk.com за веб-токеном
        // credentials: 'include' отправляет твои куки сессии VK
        const response = await fetch(`https://login.vk.com/?act=web_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                version: '1',
                app_id: APP_ID,
                access_token: '' // Пустой, так как мы авторизуемся по кукам
            }),
            credentials: 'include'
        });

        const data = await response.json();

        if (data.type === 'okay' && data.data) {
            const tokenData = Array.isArray(data.data) ? data.data[0] : data.data;
            const token = tokenData.access_token;
            
            if (!token) throw new Error('Токен не получен');

            // Отправляем токен в расширение
            chrome.runtime.sendMessage({ type: 'VKE_TOKEN_RECEIVED', token: token, userId: tokenData.user_id }, (response) => {
                if (chrome.runtime.lastError) {
                    status.innerText = '❌ Ошибка связи с расширением. Убедитесь, что оно включено и обновлено.';
                    status.className = 'status error';
                    btn.disabled = false;
                    btn.innerText = 'Попробовать снова';
                } else {
                    status.innerText = '✅ Успешно! Токен получен. Теперь удалённые сообщения будут сохраняться.';
                    status.className = 'status success';
                    desc.innerText = 'Вы можете закрыть эту вкладку.';
                    btn.style.display = 'none';
                }
            });
        } else {
            throw new Error(data.error_info || 'Неизвестная ошибка VK');
        }
    } catch (e) {
        console.error(e);
        status.innerText = '❌ Ошибка: ' + e.message + '. Попробуйте сначала зайти на vk.com в этом браузере.';
        status.className = 'status error';
        btn.disabled = false;
        btn.innerText = 'Попробовать снова';
    }
}

// Проверяем, есть ли уже токен при загрузке
window.onload = () => {
    chrome.storage.local.get(['vke_access_token'], (result) => {
        if (result.vke_access_token) {
            document.getElementById('status').innerText = '✅ Вы уже авторизованы. Удалённые сообщения сохраняются.';
            document.getElementById('status').className = 'status success';
            document.getElementById('authBtn').style.display = 'none';
            document.getElementById('desc').innerText = 'Вы можете закрыть эту вкладку.';
        }
    });
};