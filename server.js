const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const axios = require('axios');
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
            console.log(`User ${userId} joined room ${userId}, current rooms:`, Array.from(socket.rooms));

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
        roomId = String(roomId);
        socket.join(roomId);
        console.log(`Socket ${socket.id} joined room ${roomId}, current rooms:`, Array.from(socket.rooms));
        socket.emit('room-joined', { roomId });
    });

    socket.on('send-message', ({ roomId, message, sender, timestamp, from, image, msgId }) => {
        roomId = String(roomId);
        console.log(`Received send-message for room ${roomId}:`, { message, sender, timestamp, from, image, msgId });
        const roomSockets = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        console.log(`Sockets in room ${roomId}:`, roomSockets);
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
            console.log(`Broadcasted new-message to room ${roomId} for sockets:`, roomSockets);
        }
    });

    // socket.on('send-message', ({ roomId, message, sender, timestamp, from, image, msgId }) => {
    //     roomId = String(roomId);
    //     console.log(`Received send-message for room ${roomId}:`, { message, sender, timestamp, from, image, msgId });
    //     const roomSockets = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    //     console.log(`Sockets in room ${roomId}:`, roomSockets);
    //     if (roomSockets.length === 0) {
    //         console.warn(`No sockets in room ${roomId}, message not broadcasted`);
    //     } else {
    //         io.to(roomId).emit('new-message', {
    //             threadId: roomId,
    //             message,
    //             sender,
    //             timestamp,
    //             from,
    //             image,
    //             msgId
    //         });
    //         console.log(`Broadcasted new-message to room ${roomId}`);
    //     }
    // });

    // socket.on('disconnect', () => {
    //     console.log(`Client disconnected: ${socket.id}`);
    //     let disconnectedUserId = null;
    //     let userData = null;
    //     for (const [userId, data] of onlineUsers.entries()) {
    //         if (data.socketId === socket.id) {
    //             disconnectedUserId = userId;
    //             userData = data;
    //             break;
    //         }
    //     }
    //     if (disconnectedUserId && userData) {
    //         onlineUsers.delete(disconnectedUserId);
    //         console.log(`User ${disconnectedUserId} marked offline`);
    //         io.emit('user-status-update', {
    //             userId: disconnectedUserId,
    //             status: 'offline',
    //             name: userData.name,
    //             email: userData.email
    //         });
    //     }
    // });

    socket.on('disconnect', async () => {
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
            // Call logout.php to update database
            try {
                const response = await axios.post('http://localhost/chatapp_v2/user/logout.php', { uid: disconnectedUserId }, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
                console.log(`logout.php response for user ${disconnectedUserId}:`, response.data);
                if (response.data.status !== 'success') {
                    console.error(`Failed to logout user ${disconnectedUserId}:`, response.data.error);
                }
            } catch (error) {
                console.error(`Error calling logout.php for user ${disconnectedUserId}:`, error.message);
            }
            io.emit('user-status-update', {
                userId: disconnectedUserId,
                status: 'offline',
                name: userData.name,
                email: userData.email
            });
            io.emit('logout', { userId: disconnectedUserId });
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
            io.emit('logout', { userId });
        } else {
            console.warn(`Logout attempt for unknown user ${userId}`);
        }
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});