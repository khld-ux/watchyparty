const socket = io();

const loginScreen = document.getElementById('login-screen');
const roomScreen = document.getElementById('room-screen');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('room-id');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const displayRoomId = document.getElementById('display-room-id');
const participantsList = document.getElementById('participants');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const shareScreenBtn = document.getElementById('share-screen-btn');
const hostControls = document.getElementById('host-controls');
const privacyToggle = document.getElementById('privacy-toggle');
const joinRequestsArea = document.getElementById('join-requests');
const requestsList = document.getElementById('requests');
const remoteVideo = document.getElementById('remote-video');
const localVideo = document.getElementById('local-video');

let currentRoomId = null;
let myUserName = '';
let isHost = false;
let peerConnections = {}; // targetSocketId -> RTCPeerConnection

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Login Actions
createBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    const username = usernameInput.value.trim();
    const privacy = document.querySelector('input[name="privacy"]:checked').value;

    if (roomId && username) {
        myUserName = username;
        isHost = true;
        socket.emit('host-create-room', { roomId, userName: username, privacy });
    } else {
        alert('Please enter Room ID and Username');
    }
});

joinBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    const username = usernameInput.value.trim();

    if (roomId && username) {
        myUserName = username;
        isHost = false;
        socket.emit('guest-join-request', { roomId, userName: username });
    } else {
        alert('Please enter Room ID and Username');
    }
});

// Socket Event Handlers
socket.on('room-created', ({ roomId, privacy }) => {
    currentRoomId = roomId;
    showRoom(roomId);
    hostControls.style.display = 'block';
    privacyToggle.value = privacy;
});

socket.on('join-approved', ({ roomId, privacy }) => {
    currentRoomId = roomId;
    showRoom(roomId);
});

socket.on('join-denied', ({ reason }) => {
    alert(`Join denied: ${reason}`);
});


socket.on('join-request', ({ targetSocketId, userName }) => {
    joinRequestsArea.style.display = 'block';
    const li = document.createElement('li');
    li.className = 'request-item';
    li.innerHTML = `
        <span>${userName}</span>
        <div class="request-buttons">
            <button class="approve-btn" onclick="approveJoin('${targetSocketId}')">Approve</button>
            <button class="reject-btn" onclick="rejectJoin('${targetSocketId}')">Reject</button>
        </div>
    `;
    li.id = `request-${targetSocketId}`;
    requestsList.appendChild(li);
});

socket.on('guest-approved', ({ targetSocketId, userName }) => {
    const reqItem = document.getElementById(`request-${targetSocketId}`);
    if (reqItem) reqItem.remove();
    if (requestsList.children.length === 0) joinRequestsArea.style.display = 'none';

    // If host is already sharing, start WebRTC with this new guest
    if (localVideo.srcObject) {
        initiateWebRTC(targetSocketId, localVideo.srcObject);
    }
});

let lastParticipants = {};
socket.on('participants-update', (participants) => {
    lastParticipants = participants;
    participantsList.innerHTML = '';
    Object.entries(participants).forEach(([id, data]) => {
        const li = document.createElement('li');
        li.textContent = `${data.userName} (${data.role})`;
        participantsList.appendChild(li);
    });
});

socket.on('room-privacy-updated', (privacy) => {
    if (isHost) privacyToggle.value = privacy;
    addChatMessage('System', `Room privacy updated to ${privacy}`);
});

// Chat Logic
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text && currentRoomId) {
        socket.emit('chat-message', { roomId: currentRoomId, sender: myUserName, text });
        chatInput.value = '';
    }
});

socket.on('chat-message', ({ sender, text, time }) => {
    addChatMessage(sender, text, time);
});

function addChatMessage(sender, text, time = '') {
    const div = document.createElement('div');
    div.innerHTML = `<strong>[${time || new Date().toLocaleTimeString()}] ${sender}:</strong> ${text}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Room Management Functions
function showRoom(roomId) {
    loginScreen.style.display = 'none';
    roomScreen.style.display = 'flex';
    displayRoomId.textContent = `Room: ${roomId}`;
}

window.approveJoin = (targetSocketId) => {
    socket.emit('approve-join', { roomId: currentRoomId, targetSocketId });
};

window.rejectJoin = (targetSocketId) => {
    socket.emit('reject-join', { roomId: currentRoomId, targetSocketId });
};

privacyToggle.addEventListener('change', () => {
    socket.emit('set-room-privacy', { roomId: currentRoomId, privacy: privacyToggle.value });
});

// WebRTC Logic
shareScreenBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        localVideo.srcObject = stream;
        localVideo.style.display = 'block';
        shareScreenBtn.disabled = true;

        // When host starts sharing, we need to send offers to everyone.
        socket.emit('chat-message', { roomId: currentRoomId, sender: 'System', text: 'Host started screen sharing' });

        Object.keys(lastParticipants).forEach(targetSocketId => {
            if (targetSocketId !== socket.id) {
                initiateWebRTC(targetSocketId, stream);
            }
        });
    } catch (err) {
        console.error('Error sharing screen:', err);
    }
});

async function initiateWebRTC(targetSocketId, stream) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[targetSocketId] = pc;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { targetSocketId, candidate: event.candidate });
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { targetSocketId, offer });
}

socket.on('offer', async ({ fromSocketId, offer }) => {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[fromSocketId] = pc;

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { targetSocketId: fromSocketId, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { targetSocketId: fromSocketId, answer });
});

socket.on('answer', async ({ fromSocketId, answer }) => {
    const pc = peerConnections[fromSocketId];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('ice-candidate', async ({ fromSocketId, candidate }) => {
    const pc = peerConnections[fromSocketId];
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('participant-left', ({ socketId }) => {
    if (peerConnections[socketId]) {
        peerConnections[socketId].close();
        delete peerConnections[socketId];
    }
});

socket.on('room-closed', () => {
    alert('Room has been closed by the host');
    location.reload();
});
