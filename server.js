const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const axios = require('axios');
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ['https://coddot.in/'],
        methods: ['GET', 'POST']
    }
});

const onlineUsers = new Map();
const DISCONNECT_GRACE_PERIOD = 7000;

app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        }
    }
}));

io.on('connection', (socket) => {
    socket.on('register', async ({ userId, name, email, message, timestamp }) => {
        if (userId) {

            try {
                const response = await axios.post('https://coddot.in/chatapp_v2/user/backend/threads.php?action=blockedUser', { uid: userId }, {
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
            const response = await axios.post('https://coddot.in/chatapp_v2/user/backend/threads.php?action=blockedUser', { uid: roomId }, {
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

    // socket.on('disconnect', async () => {
    //     let disconnectedUserId = null;
    //     let userData = null;
    //     for (const [userId, data] of onlineUsers.entries()) {
    //         if (data.socketId === socket.id) {
    //             disconnectedUserId = userId;
    //             userData = data;
    //             break;
    //         }
    //     }
    //     if (disconnectedUserId && userData && onlineUsers.has(disconnectedUserId)) {
    //         const disconnectTimeout = setTimeout(async () => {
    //             if (!onlineUsers.has(disconnectedUserId)) return;
    //             onlineUsers.delete(disconnectedUserId);
                
    //             try {
    //                 const response = await axios.post('http://localhost/chatapp_v2/user/logout.php', { uid: disconnectedUserId }, {
    //                     headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    //                 });

    //                 if (response.data.status !== 'success') {
    //                     console.error(`Failed to logout user ${disconnectedUserId}:`, response.data.error);
    //                 }
    //             } catch (error) {
    //                 console.error(`Error calling logout.php for user ${disconnectedUserId}:`, error.message);
    //             }
    //             io.emit('user-status-update', {
    //                 userId: disconnectedUserId,
    //                 status: 'offline',
    //                 name: userData.name,
    //                 email: userData.email
    //             });
    //             io.emit('logout', { userId: disconnectedUserId });
    //         }, DISCONNECT_GRACE_PERIOD);

    //         userData.disconnectTimeout = disconnectTimeout;
    //         onlineUsers.set(disconnectedUserId, userData);
    //     }
    // });

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

    // socket.on('logout', async ({ userId }) => {
    //     if (onlineUsers.has(userId)) {
    //         const userData = onlineUsers.get(userId);

    //         if (userData.disconnectTimeout) {
    //             clearTimeout(userData.disconnectTimeout);
    //         }
    //         onlineUsers.delete(userId);

    //         try {
    //             const response = await axios.post('http://localhost/chatapp_v2/user/logout.php', { uid: userId }, {
    //                 headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    //             });

    //             if (response.data.status !== 'success') {
    //                 console.error(`Failed to logout user ${userId}:`, response.data.error);
    //             }
    //         } catch (error) {
    //             console.error(`Error calling logout.php for user ${userId}:`, error.message);
    //         }
    //         io.emit('user-status-update', {
    //             userId,
    //             status: 'offline',
    //             name: userData.name,
    //             email: userData.email
    //         });
    //         io.emit('logout', { userId });
    //     } else {
    //         console.warn(`Logout attempt for unknown user ${userId}`);
    //     }
    // });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});