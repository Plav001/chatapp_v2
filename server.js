const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const axios = require('axios');
const server = http.createServer(app);
const bodyParser = require('body-parser');
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const onlineUsers = new Map();
const DISCONNECT_GRACE_PERIOD = 7000;

app.use(bodyParser.json());

app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        }
    }
}));

app.post('/emit-message', (req, res) => {
    const { threadId, message, sender, timestamp, from, image, msgId } = req.body;

    // Validate required fields
    if (!threadId || !message || !sender || !timestamp || !from || !msgId) {
        console.error('Invalid emit-message payload:', req.body);
        return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    }

    // Emit message to the specified room
    const roomSockets = Array.from(io.sockets.adapter.rooms.get(String(threadId)) || []);
    if (roomSockets.length === 0) {
        console.warn(`No sockets in room ${threadId}, message not broadcasted`);
    } else {
        io.to(String(threadId)).emit('new-message', {
            threadId,
            message,
            sender,
            timestamp,
            from,
            image,
            msgId
        });
        console.log(`Emitted message to room ${threadId}:`, { message, sender, from, msgId });
    }

    res.json({ status: 'success' });
});

io.on('connection', (socket) => {
    socket.on('register', async ({ userId, name, email, message, timestamp }) => {
        if (userId) {

            try {
                const response = await axios.post('https://coddot.in/chatapp_v3/user/backend/threads.php?action=blockedUser', { uid: userId }, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
                if (response.data.status === 'success' && response.data.blocked) {
                    socket.emit('user-blocked', { userId, blocked: true });
                    return;
                }
            } catch (error) {
                console.error(`Error checking block status for user ${userId}:`, error.message);
            }

            if (onlineUsers.has(userId)) {
                const userData = onlineUsers.get(userId);
                if (userData.disconnectTimeout) {
                    clearTimeout(userData.disconnectTimeout);
                }
            }
            onlineUsers.set(userId, { 
                socketId: socket.id, 
                name, 
                email, 
                status: 'online',
                disconnectTimeout: null // Initialize disconnect timeout as null
            });
            socket.join(userId);

            const statusUpdate = { userId, status: 'online', name, email, message, timestamp };

            io.emit('user-status-update', statusUpdate);
            io.emit('online-users', Array.from(onlineUsers.entries()).map(([id, data]) => ({
                userId: id,
                name: data.name,
                email: data.email,
                status: data.status
            })));
        } else {
            console.error('Invalid userId in register event');
        }
    });

    socket.on('join-room', async (roomId) => {
        roomId = String(roomId);

        try {
            const response = await axios.post('https://coddot.in/chatapp_v3/user/backend/threads.php?action=blockedUser', { uid: roomId }, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            if (response.data.status === 'success' && response.data.blocked) {
                socket.emit('user-blocked', { roomId, blocked: true });
                return;
            }
        } catch (error) {
            console.error(`Error checking block status for user ${userId}:`, error.message);
        }

        socket.join(roomId);
        socket.emit('room-joined', { roomId });
    });

    socket.on('admin-block-user', ({ userId, blocked }) => {
        io.to(userId).emit('user-blocked', { userId, blocked });
        io.emit('user-status-updated', { userId, blocked });
        if (blocked && onlineUsers.has(userId)) {
            const userData = onlineUsers.get(userId);
            if (userData.disconnectTimeout) {
                clearTimeout(userData.disconnectTimeout);
            }
            onlineUsers.delete(userId);
            io.emit('user-status-update', {
                userId,
                status: 'offline',
                name: userData.name,
                email: userData.email
            });
        }
    });

    socket.on('send-message', ({ roomId, message, sender, timestamp, from, image, msgId }) => {
        roomId = String(roomId);
        
        const roomSockets = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        
        if (roomSockets.length === 0) {
            console.warn(`No sockets in room ${roomId}, message not broadcasted`);
        } else {
            io.to(roomId).emit('new-message', {
                threadId: roomId,
                message,
                sender,
                timestamp,
                from,
                image,
                msgId
            });
        }
    });

    socket.on('disconnect', () => {
        let disconnectedUserId = null;
        let userData = null;
        for (const [userId, data] of onlineUsers.entries()) {
            if (data.socketId === socket.id) {
                disconnectedUserId = userId;
                userData = data;
                break;
            }
        }
        if (disconnectedUserId && userData) {
            onlineUsers.delete(disconnectedUserId);
            io.emit('user-status-update', {
                userId: disconnectedUserId,
                status: 'offline',
                name: userData.name,
                email: userData.email
            });
        }
    });

    socket.on('logout', ({ userId }) => {
        if (onlineUsers.has(userId)) {
            const userData = onlineUsers.get(userId);
            onlineUsers.delete(userId);
            io.emit('user-status-update', {
                userId,
                status: 'offline',
                name: userData.name,
                email: userData.email
            });
            io.emit('logout', { userId });
        } else {
            console.warn(`Logout attempt for unknown user ${userId}`);
        }
    });

    socket.on('request-user-status', (threadId) => {
        threadId = String(threadId);
        const userData = onlineUsers.get(threadId);
        const status = userData ? 'online' : 'offline';
        console.log(`Request status for ${threadId}: ${status}, userData: ${JSON.stringify(userData)}`);
        socket.emit('user-status-update', {
            userId: threadId,
            status,
            name: userData?.name || 'Unknown',
            email: userData?.email || '',
            timestamp: Date.now()
        });
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});