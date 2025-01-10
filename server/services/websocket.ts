import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { db } from "@db";
import { userTraining } from "@db/schema";
import { eq } from "drizzle-orm";

interface User {
  id: string;
  name: string;
  avatar?: string;
  status: 'online' | 'away' | 'offline';
  lastSeen?: Date;
  socketId: string;
  trainingLevel?: {
    level: string;
    progress: number;
  };
}

const users = new Map<string, User>();
const clients = new Map<string, string>(); // userId -> socketId

export function setupWebSocketServer(server: HttpServer) {
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Broadcast presence update to all clients
  function broadcastPresence() {
    const activeUsers = Array.from(users.values()).map(({ socketId, ...user }) => user);
    io.emit('ONLINE_USERS_UPDATE', { users: activeUsers });
  }

  // Broadcast training level update to a specific user
  async function broadcastTrainingLevel(userId: string) {
    try {
      // Get all completed training modules for the user
      const completedModules = await db
        .select()
        .from(userTraining)
        .where(eq(userTraining.userId, userId));

      // Calculate overall progress
      let totalProgress = 0;
      if (completedModules.length > 0) {
        const completedCount = completedModules.filter(m => m.status === 'completed').length;
        totalProgress = (completedCount / completedModules.length) * 100;
      }

      // Determine level based on overall progress
      let level = "Beginner";
      if (totalProgress >= 80) {
        level = "Expert";
      } else if (totalProgress >= 50) {
        level = "Intermediate";
      }

      const trainingLevel = {
        level,
        progress: Math.round(totalProgress)
      };

      // Update user's training level in memory
      const user = users.get(userId);
      if (user) {
        users.set(userId, { ...user, trainingLevel });
      }

      // Emit training level update to the specific user
      io.to(clients.get(userId) || '').emit('training:level', trainingLevel);
    } catch (error) {
      console.error("Error broadcasting training level:", error);
    }
  }

  // Create WebSocket interface object with all required methods
  const wsInterface = {
    broadcast: (userIds: string[], message: any) => {
      userIds.forEach(userId => {
        const socketId = clients.get(userId);
        if (socketId) {
          io.to(socketId).emit('notification', message);
        }
      });
    },
    registerUser: (userId: string) => {
      users.set(userId, {
        id: userId,
        name: `User ${userId.slice(0, 4)}`,
        status: 'online',
        socketId: clients.get(userId) || '',
        lastSeen: new Date()
      });
      broadcastPresence();
    },
    unregisterUser: (userId: string) => {
      const user = users.get(userId);
      if (user) {
        users.set(userId, { ...user, status: 'offline', lastSeen: new Date() });
      }
      clients.delete(userId);
      broadcastPresence();
    },
    broadcastTrainingLevel,
    getActiveUsers: () => {
      return Array.from(users.values())
        .filter(user => user.status === 'online')
        .map(user => user.id);
    },
    close: () => {
      io.close();
    }
  };

  // Handle socket connections
  io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId as string;

    if (!userId) {
      socket.disconnect();
      return;
    }

    // Store the socket ID for this user
    clients.set(userId, socket.id);

    // Handle presence events
    socket.on('presence:join', async ({ userId: uid, name = `User ${uid.slice(0, 4)}` }) => {
      const user = users.get(uid);
      if (user) {
        users.set(uid, { ...user, status: 'online', name, lastSeen: new Date() });
      } else {
        wsInterface.registerUser(uid);
      }
      await broadcastTrainingLevel(uid);
      broadcastPresence();
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      if (userId) {
        wsInterface.unregisterUser(userId);
      }
    });

    // Handle user status updates
    socket.on('presence:status', ({ status }) => {
      const user = users.get(userId);
      if (user) {
        users.set(userId, { ...user, status, lastSeen: new Date() });
        broadcastPresence();
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      if (clients.get(userId) === socket.id) {
        wsInterface.unregisterUser(userId);
      }
    });
  });

  return wsInterface;
}