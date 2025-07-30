const roomName = window.location.pathname.substring(1);
const roomTitle = document.getElementById('room-title');
const linksContainer = document.getElementById('links-container');

// Set dynamic page and tab titles
document.title = roomName;
roomTitle.textContent = roomName;

const socket = io();
socket.emit('join_room', roomName);

// --- New Robust Copy Function ---
function copyToClipboard(text) {
    // Try the modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    } else {
        // Fallback for older browsers or insecure contexts
        let textArea = document.createElement("textarea");
        textArea.value = text;
        // Make the textarea out of sight
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        return new Promise((res, rej) => {
            // execCommand is deprecated but serves as a great fallback
            document.execCommand('copy') ? res() : rej();
            textArea.remove();
        });
    }
}


// --- Render Function ---
function renderLink(link) {
    const linkItemWrapper = document.createElement('div');
    linkItemWrapper.id = `link-${link.id}`;
    linkItemWrapper.className = 'link-item';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'کپی';
    copyBtn.dataset.url = link.url;

    const linkUrl = document.createElement('a');
    linkUrl.href = link.url;
    linkUrl.className = 'link-url';
    linkUrl.textContent = link.url;
    linkUrl.target = '_blank';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'link-status';

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
    const copyBtn = element.querySelector('.copy-btn');
    
    if (link.status === 'full') {
        element.classList.add('locked');
        linkAnchor.onclick = (e) => e.preventDefault();
        copyBtn.disabled = true;
    } else {
        linkAnchor.onclick = null;
        copyBtn.disabled = false;
    }
}

// --- Event Handlers ---
linksContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-btn')) {
        const btn = e.target;
        const urlToCopy = btn.dataset.url;
        
        copyToClipboard(urlToCopy).then(() => {
            btn.textContent = 'کپی شد!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = 'کپی';
                btn.classList.remove('copied');
            }, 2000);
        }).catch(() => {
            // This will only be called if both methods fail
            alert('خطا در کپی کردن لینک.');
        });
    }
});


// --- Initial Data Load & Socket Listeners ---
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