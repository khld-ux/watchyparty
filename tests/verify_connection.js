const io = require('socket.io-client');
const http = require('http');

const PORT = 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// Function to wait for an event
const waitFor = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

async function runTest() {
    console.log('Starting verification test...');

    const hostSocket = io(SERVER_URL);
    const guestSocket = io(SERVER_URL);

    try {
        // Test 1: Host creates a room
        hostSocket.emit('host-create-room', { roomId: 'test-room', userName: 'HostUser', privacy: 'public' });
        const roomCreatedData = await waitFor(hostSocket, 'room-created');
        console.log('Test 1 Passed: Room created', roomCreatedData);

        // Test 2: Guest joins the room
        guestSocket.emit('guest-join-request', { roomId: 'test-room', userName: 'GuestUser' });
        const joinApprovedData = await waitFor(guestSocket, 'join-approved');
        console.log('Test 2 Passed: Guest joined', joinApprovedData);

        // Test 3: Chat message
        hostSocket.emit('chat-message', { roomId: 'test-room', sender: 'HostUser', text: 'Hello Guest' });
        const chatData = await waitFor(guestSocket, 'chat-message');
        if (chatData.text === 'Hello Guest' && chatData.sender === 'HostUser') {
            console.log('Test 3 Passed: Chat message received', chatData);
        } else {
            throw new Error('Chat message mismatch');
        }

        console.log('All backend tests passed!');
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    } finally {
        hostSocket.close();
        guestSocket.close();
    }
}

runTest();
