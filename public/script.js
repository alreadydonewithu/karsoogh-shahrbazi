const roomName = window.location.pathname.substring(1);
const roomTitle = document.getElementById('room-title');
const linksContainer = document.getElementById('links-container');

// ۱. تنظیم عنوان تب مرورگر و عنوان اصلی صفحه
document.title = roomName;
roomTitle.textContent = roomName;

const socket = io();
socket.emit('join_room', roomName);

// --- توابع رندر کردن ---

function renderLink(link) {
    const linkItemWrapper = document.createElement('div');
    linkItemWrapper.id = `link-${link.id}`;
    linkItemWrapper.className = 'link-item';

    // ۲. اضافه کردن دکمه کپی
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'کپی';
    copyBtn.dataset.url = link.url; // ذخیره کردن آدرس در دیتای دکمه

    const linkUrl = document.createElement('a');
    linkUrl.href = link.url;
    linkUrl.className = 'link-url';
    linkUrl.textContent = link.url;
    linkUrl.target = '_blank';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'link-status';

    // چیدن اجزا در آیتم اصلی
    linkItemWrapper.appendChild(copyBtn);
    linkItemWrapper.appendChild(linkUrl);
    linkItemWrapper.appendChild(statusSpan);
    
    updateLinkElement(linkItemWrapper, link);
    linksContainer.appendChild(linkItemWrapper);
}

function updateLinkElement(element, link) {
    let statusText = '';
    switch (link.status) {
        case 'available': statusText = 'خالی'; break;
        case 'filling': statusText = 'درحال پر شدن'; break;
        case 'full': statusText = 'اتمام ظرفیت'; break;
    }
    element.querySelector('.link-status').textContent = statusText;
    
    element.classList.remove('status-available', 'status-filling', 'status-full', 'locked');
    element.classList.add(`status-${link.status}`);
    
    const linkAnchor = element.querySelector('.link-url');
    const copyBtn = element.querySelector('.copy-btn'); // دکمه کپی را پیدا می‌کنیم
    
    if (link.status === 'full') {
        element.classList.add('locked');
        linkAnchor.onclick = (e) => e.preventDefault();
        copyBtn.disabled = true; // دکمه کپی غیرفعال می‌شود
    } else {
        linkAnchor.onclick = null;
        copyBtn.disabled = false; // دکمه کپی دوباره فعال می‌شود
    }
}

// --- مدیریت رویدادها ---

// ۴. مدیریت کلیک روی دکمه‌های کپی با Event Delegation
linksContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-btn')) {
        const btn = e.target;
        const urlToCopy = btn.dataset.url;
        
        navigator.clipboard.writeText(urlToCopy).then(() => {
            // ارائه بازخورد به کاربر
            btn.textContent = 'کپی شد!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = 'کپی';
                btn.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('امکان کپی وجود ندارد: ', err);
            alert('کپی با خطا مواجه شد.');
        });
    }
});


// --- بارگذاری اولیه و شنود رویدادهای سوکت ---

async function fetchInitialLinks() {
    const response = await fetch(`/api/rooms/${roomName}/links`);
    const links = await response.json();
    linksContainer.innerHTML = '';
    links.forEach(renderLink);
}

socket.on('link_added', renderLink);

socket.on('link_updated', (updatedLink) => {
    const linkEl = document.getElementById(`link-${updatedLink.id}`);
    if (linkEl) {
        // آپدیت کردن تمام بخش‌های لینک
        const linkAnchor = linkEl.querySelector('.link-url');
        linkAnchor.href = updatedLink.url;
        linkAnchor.textContent = updatedLink.url;
        linkEl.querySelector('.copy-btn').dataset.url = updatedLink.url;
        updateLinkElement(linkEl, updatedLink);
    }
});

socket.on('link_deleted', (data) => {
    const linkEl = document.getElementById(`link-${data.id}`);
    if (linkEl) linkEl.remove();
});

fetchInitialLinks();