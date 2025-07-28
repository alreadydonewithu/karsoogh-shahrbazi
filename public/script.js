const roomName = window.location.pathname.substring(1);
const roomTitle = document.getElementById('room-title');
const linksContainer = document.getElementById('links-container');

roomTitle.textContent = `اتاق: ${roomName}`;
const socket = io();
socket.emit('join_room', roomName);

// --- Render Function ---
function renderLink(link) {
    const linkItem = document.createElement('a');
    linkItem.id = `link-${link.id}`;
    linkItem.href = link.url;
    linkItem.className = 'link-item';
    linkItem.target = '_blank';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'link-url';
    urlSpan.textContent = link.url;

    const statusSpan = document.createElement('span');
    statusSpan.className = 'link-status';

    linkItem.appendChild(urlSpan);
    linkItem.appendChild(statusSpan);
    updateLinkElement(linkItem, link); // Set status and style
    linksContainer.appendChild(linkItem);
}

function updateLinkElement(element, link) {
    let statusText = '';
    switch (link.status) {
        case 'available': statusText = 'خالی'; break;
        case 'filling': statusText = 'درحال پر شدن'; break;
        case 'full': statusText = 'اتمام ظرفیت'; break;
    }
    element.querySelector('.link-status').textContent = statusText;
    
    // Reset classes
    element.classList.remove('status-available', 'status-filling', 'status-full', 'locked');

    element.classList.add(`status-${link.status}`);
    if (link.status === 'full') {
        element.classList.add('locked');
        element.onclick = (e) => {
            e.preventDefault();
            alert('ظرفیت این لینک تمام شده است.');
        };
    } else {
        element.onclick = null; // Remove click blocker
    }
}

// --- Initial Data Load ---
async function fetchInitialLinks() {
    const response = await fetch(`/api/rooms/${roomName}/links`);
    const links = await response.json();
    linksContainer.innerHTML = '';
    links.forEach(renderLink);
}

// --- Socket.IO Listeners ---
socket.on('link_added', (newLink) => {
    renderLink(newLink);
});

socket.on('link_updated', (updatedLink) => {
    const linkEl = document.getElementById(`link-${updatedLink.id}`);
    if (linkEl) {
        linkEl.href = updatedLink.url;
        linkEl.querySelector('.link-url').textContent = updatedLink.url;
        updateLinkElement(linkEl, updatedLink);
    }
});

socket.on('link_deleted', (data) => {
    const linkEl = document.getElementById(`link-${data.id}`);
    if (linkEl) {
        linkEl.remove();
    }
});

fetchInitialLinks();