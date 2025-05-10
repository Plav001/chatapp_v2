const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const onlineUsers = new Map();

app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        }
    }
}));

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('register', ({ userId, name, email, message, timestamp }) => {
        if (userId) {
            console.log(`Received register event for user ${userId}:`, { name, email, message, timestamp });
            if (onlineUsers.has(userId)) {
                console.log(`User ${userId} re-registered, updating socket ID`);
            }
            onlineUsers.set(userId, { socketId: socket.id, name, email, status: 'online' });
            socket.join(userId);
            console.log(`User ${userId} joined room ${userId}`);

            const statusUpdate = { userId, status: 'online', name, email, message, timestamp };
            console.log(`Emitting user-status-update:`, statusUpdate);
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

    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`Socket ${socket.id} joined room ${roomId}, current rooms:`, socket.rooms);
    });

    socket.on('send-message', ({ roomId, message, sender, from, timestamp, image }) => {
        console.log(`Message sent to room ${roomId} by ${sender} (${from}):`, { message, timestamp, image });
        io.to(roomId).emit('new-message', { threadId: roomId, message, sender, from, timestamp, image });
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
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
            console.log(`User ${disconnectedUserId} marked offline`);
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
            console.log(`User ${userId} logged out`);
            io.emit('user-status-update', {
                userId,
                status: 'offline',
                name: userData.name,
                email: userData.email
            });
        } else {
            console.warn(`Logout attempt for unknown user ${userId}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});