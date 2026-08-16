const APP_ID = 6287487;

async function startAuth() {
    const btn = document.getElementById('authBtn');
    const status = document.getElementById('status');
    
    btn.disabled = true;
    btn.innerText = 'Получение токена...';
    status.innerText = '';
    status.className = 'status';

    try {
        const response = await fetch(`https://login.vk.com/?act=web_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ version: '1', app_id: APP_ID, access_token: '' }),
            credentials: 'include'
        });

        const data = await response.json();

        if (data.type === 'okay' && data.data) {
            const tokenData = Array.isArray(data.data) ? data.data[0] : data.data;
            const token = tokenData.access_token;
            
            if (!token) throw new Error('Токен не получен');

            window.postMessage({ type: 'VKE_AUTH_REQUEST', payload: { token: token, userId: tokenData.user_id } }, '*');

            const bridgeResponse = await new Promise((resolve) => {
                const handler = (event) => {
                    if (event.source !== window) return;
                    if (event.data && event.data.type === 'VKE_AUTH_RESPONSE') {
                        window.removeEventListener('message', handler);
                        resolve(event.data);
                    }
                };
                window.addEventListener('message', handler);
                setTimeout(() => {
                    window.removeEventListener('message', handler);
                    resolve({ error: 'Timeout: Расширение не ответило' });
                }, 5000);
            });

            if (bridgeResponse.error) throw new Error(bridgeResponse.error);

            status.innerText = '✅ Успешно! Токен передан.';
            status.className = 'status success';
            btn.style.display = 'none';
            
        } else {
            throw new Error(data.error_info || 'Ошибка VK');
        }
    } catch (e) {
        console.error(e);
        status.innerText = '❌ Ошибка: ' + e.message;
        status.className = 'status error';
        btn.disabled = false;
        btn.innerText = 'Попробовать снова';
    }
}
