import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "@db";
import { chats, messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { setupWebSocketServer } from "./services/websocket";
import { getChatCompletion } from "./services/azure-openai";
import { generateReport } from "./services/document-generator";
import { join } from "path";
import express from "express";

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const wsServer = setupWebSocketServer(httpServer);

  // Clean up WebSocket server when HTTP server closes
  httpServer.on('close', () => {
    wsServer.close();
  });

  // Add uploads directory for serving generated files
  app.use('/uploads', express.static('uploads'));

  // Get all chats for the current user
  app.get("/api/chats", async (req, res) => {
    try {
      // For now, using a mock user ID until auth is implemented
      const userId = "user123";
      const userChats = await db.query.chats.findMany({
        where: eq(chats.userId, userId),
        orderBy: [desc(chats.lastMessageAt)],
        with: {
          messages: {
            limit: 1,
            orderBy: [desc(messages.createdAt)],
          },
        },
      });

      res.json(userChats);
    } catch (error) {
      console.error("Error fetching chats:", error);
      res.status(500).json({ error: "Failed to fetch chats" });
    }
  });

  // Get a specific chat
  app.get("/api/chats/:id", async (req, res) => {
    try {
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, parseInt(req.params.id)),
        with: {
          messages: true,
        },
      });

      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }

      res.json(chat);
    } catch (error) {
      console.error("Error fetching chat:", error);
      res.status(500).json({ error: "Failed to fetch chat" });
    }
  });

  // Create a new chat with AI-generated title
  app.post("/api/chats", async (req, res) => {
    try {
      const { content } = req.body;
      const userId = "user123"; // Mock user ID until auth is implemented

      // Generate a title for the chat based on the first message
      const titleResponse = await getChatCompletion([
        {
          role: "system",
          content: "Generate a brief, descriptive title (max 6 words) for a chat that starts with this message. Return only the title text."
        },
        { role: "user", content }
      ]);

      // Create new chat
      const [chat] = await db.insert(chats)
        .values({
          title: titleResponse.trim(),
          userId,
          lastMessageAt: new Date(),
        })
        .returning();

      // Create first message
      await db.insert(messages)
        .values({
          chatId: chat.id,
          role: 'user',
          content,
        });

      res.json(chat);
    } catch (error) {
      console.error("Error creating chat:", error);
      res.status(500).json({ error: "Failed to create chat" });
    }
  });

  // Update chat title
  app.patch("/api/chats/:id", async (req, res) => {
    try {
      const { title } = req.body;
      const [updatedChat] = await db.update(chats)
        .set({ title })
        .where(eq(chats.id, parseInt(req.params.id)))
        .returning();

      res.json(updatedChat);
    } catch (error) {
      console.error("Error updating chat:", error);
      res.status(500).json({ error: "Failed to update chat" });
    }
  });

  // Chat message endpoint
  app.post("/api/messages", async (req, res) => {
    try {
      const { content, chatId } = req.body;

      // Save user message
      const [userMessage] = await db.insert(messages)
        .values({
          chatId: parseInt(chatId),
          role: 'user',
          content,
        })
        .returning();

      // Update chat's last message timestamp
      await db.update(chats)
        .set({ lastMessageAt: new Date() })
        .where(eq(chats.id, parseInt(chatId)));

      // Check if this is a direct request for a report
      if (content.toLowerCase().includes('yes, generate') || 
          content.toLowerCase().includes('yes, give me') ||
          content.toLowerCase().includes('generate a downloadable') ||
          content.toLowerCase().includes('create a downloadable')) {
        try {
          const reportTopic = content.replace(/yes,?\s*(generate|create|give me)\s*(a|the)?\s*report/i, '').trim();
          const filename = await generateReport(reportTopic);
          const message = {
            id: Date.now(),
            content: `I've prepared a detailed report based on your request. You can download it here:\n\n[Click here to download the report](/uploads/${filename})`,
            role: 'assistant'
          };
          return res.json(message);
        } catch (error) {
          console.error("Error generating report:", error);
          return res.json({
            id: Date.now(),
            content: "I apologize, but I encountered an error while generating the report. Please try again.",
            role: 'assistant'
          });
        }
      }

      // Get chat completion from Azure OpenAI
      const response = await getChatCompletion([
        { 
          role: "system", 
          content: "You are GYM AI Engine, an intelligent assistant helping users with gym management, training, and equipment maintenance. Format your responses using Markdown:\n\n- Use # for main headings\n- Use ** for bold text\n- Use - for bullet points\n- Use 1. for numbered lists\n\nWhen users ask for a report or analysis, respond with: 'I can help you create a detailed report on [topic]. Would you like me to generate a downloadable Word document for you? Just let me know by saying \"Yes, generate the report\" and I'll create a comprehensive document that you can download.'\n\nFor reports, provide extensive detail including market analysis, trends, statistics, and in-depth explanations. Structure the content with clear sections and subsections."
        },
        { role: "user", content }
      ]);

      // Save assistant message
      const [assistantMessage] = await db.insert(messages)
        .values({
          chatId: parseInt(chatId),
          role: 'assistant',
          content: response,
        })
        .returning();

      res.json(assistantMessage);
    } catch (error) {
      console.error("Error processing message:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  // Get chat messages
  app.get("/api/messages/:chatId", async (req, res) => {
    try {
      const chatMessages = await db.query.messages.findMany({
        where: eq(messages.chatId, parseInt(req.params.chatId)),
        orderBy: [messages.createdAt],
      });

      res.json(chatMessages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });
  // Generate report endpoint
  app.post("/api/generate-report", async (req, res) => {
    try {
      const { topic } = req.body;
      const filename = await generateReport(topic);
      res.json({ downloadUrl: `/uploads/${filename}` });
    } catch (error) {
      console.error("Error generating report:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // Get chat messages endpoint
  app.get("/api/messages/:chatId?", async (req, res) => {
    try {
      // For now, return an empty array as we haven't implemented message persistence yet
      res.json([]);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Example equipment data route
  app.get("/api/equipment", async (_req, res) => {
    try {
      // Return sample equipment data
      const sampleEquipment = [
        {
          id: 1,
          name: "Treadmill X-1000",
          status: "active",
          healthScore: 95.5,
          lastMaintenance: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          nextMaintenance: new Date(Date.now() + 23 * 24 * 60 * 60 * 1000).toISOString(),
          maintenanceType: "Regular checkup",
          deviceConnectionStatus: "connected",
          position: { x: 10, y: 20 }
        },
        {
          id: 2,
          name: "Elliptical E-2000",
          status: "maintenance",
          healthScore: 75.0,
          lastMaintenance: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          nextMaintenance: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          maintenanceType: "Belt replacement",
          deviceConnectionStatus: "connected",
          position: { x: 30, y: 40 }
        },
        {
          id: 3,
          name: "Rowing Machine R-500",
          status: "error",
          healthScore: 45.5,
          lastMaintenance: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
          nextMaintenance: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
          maintenanceType: "Urgent repair",
          deviceConnectionStatus: "disconnected",
          position: { x: 50, y: 60 }
        },
        {
          id: 4,
          name: "Strength Station S-3000",
          status: "active",
          healthScore: 88.5,
          lastMaintenance: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
          nextMaintenance: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
          maintenanceType: "Regular checkup",
          deviceConnectionStatus: "connected",
          position: { x: 70, y: 80 }
        },
        {
          id: 5,
          name: "Cycling Bike C-800",
          status: "active",
          healthScore: 92.0,
          lastMaintenance: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          nextMaintenance: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
          maintenanceType: "Regular checkup",
          deviceConnectionStatus: "connected",
          position: { x: 90, y: 100 }
        }
      ];

      res.json(sampleEquipment);
    } catch (error) {
      console.error("Error fetching equipment:", error);
      res.status(500).json({ error: "Failed to fetch equipment" });
    }
  });

  // Update equipment position
  app.patch("/api/equipment/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { position } = req.body;

      // For demo, just return success
      res.json({ success: true, id, position });
    } catch (error) {
      console.error("Error updating equipment:", error);
      res.status(500).json({ error: "Failed to update equipment" });
    }
  });

  // Get active floor plan
  app.get("/api/floor-plans/active", async (_req, res) => {
    try {
      // Return a sample floor plan
      res.json({
        id: 1,
        name: "Default Layout",
        dimensions: { width: 800, height: 600 },
        gridSize: 20,
        isActive: true,
        metadata: {
          zones: [
            { name: "Cardio Area", bounds: { x: 0, y: 0, width: 400, height: 300 } },
            { name: "Weight Training", bounds: { x: 400, y: 0, width: 400, height: 300 } },
            { name: "Group Fitness", bounds: { x: 0, y: 300, width: 800, height: 300 } }
          ]
        }
      });
    } catch (error) {
      console.error("Error fetching floor plan:", error);
      res.status(500).json({ error: "Failed to fetch floor plan" });
    }
  });

  // Save floor plan
  app.post("/api/floor-plans", async (req, res) => {
    try {
      const floorPlan = req.body;
      // For demo, just return success
      res.json({ success: true, id: floorPlan.id || 1 });
    } catch (error) {
      console.error("Error saving floor plan:", error);
      res.status(500).json({ error: "Failed to save floor plan" });
    }
  });

  // Equipment predictions
  app.get("/api/equipment/:id/predictions", async (req, res) => {
    try {
      const { id } = req.params;
      // Return sample prediction data
      res.json({
        equipmentId: parseInt(id),
        predictions: {
          maintenanceScore: Math.random() * 100,
          nextFailureProbability: Math.random(),
          recommendedActions: [
            "Schedule routine maintenance",
            "Check belt tension",
            "Verify sensor calibration"
          ],
          usagePattern: {
            morning: Math.random() * 100,
            afternoon: Math.random() * 100,
            evening: Math.random() * 100
          }
        }
      });
    } catch (error) {
      console.error("Error fetching predictions:", error);
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });

  // Notification broadcast function
  async function broadcastNotification(notification: typeof notifications.$inferInsert, userIds: string[]) {
    try {
      // Insert notification
      const [createdNotification] = await db.insert(notifications)
        .values(notification)
        .returning();

      // Create user notifications
      await db.insert(userNotifications)
        .values(userIds.map(userId => ({
          userId,
          notificationId: createdNotification.id,
        })));

      // Broadcast to connected clients
      wsServer.broadcast(userIds, {
        type: 'notification',
        data: createdNotification,
      });

      return createdNotification;
    } catch (error) {
      console.error('Error broadcasting notification:', error);
      throw error;
    }
  }

  // Notification API routes
  app.get("/api/notifications", async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }

      const userNotifs = await db.query.userNotifications.findMany({
        where: eq(userNotifications.userId, userId),
        with: {
          notification: true,
        },
        orderBy: [desc(userNotifications.createdAt)],
      });

      res.json(userNotifs);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.post("/api/notifications/mark-read", async (req, res) => {
    try {
      const { userId, notificationIds } = req.body;

      await db.update(userNotifications)
        .set({
          read: true,
          readAt: new Date(),
        })
        .where(and(
          eq(userNotifications.userId, userId),
          eq(userNotifications.notificationId, notificationIds)
        ));

      res.json({ success: true });
    } catch (error) {
      console.error("Error marking notifications as read:", error);
      res.status(500).json({ error: "Failed to mark notifications as read" });
    }
  });

  // Training Module Routes
  app.post("/api/training/assign-module", async (req, res) => {
    try {
      const { userId, moduleId } = req.body;

      // Then send notification
      await broadcastNotification({
        type: 'module_assigned',
        title: 'New Training Module Assigned',
        message: `A new training module has been assigned to you.`,
        priority: 'medium',
        metadata: { moduleId },
      }, [userId]);

      res.json({
        success: true,
        message: "Module assigned successfully",
        assignment: { userId, moduleId, assignedAt: new Date() }
      });
    } catch (error) {
      console.error("Error assigning module:", error);
      res.status(500).json({ error: "Failed to assign module" });
    }
  });

  app.get("/api/training/progress", async (_req, res) => {
    try {
      // Return sample training progress data
      const progressData = {
        currentLevel: 2,
        currentExp: 750,
        nextLevelExp: 1000,
        modules: [
          {
            id: "module-1",
            title: "Azure Blob Storage Fundamentals",
            description: "Learn the basics of Azure Blob Storage and how to use it effectively",
            completedLessons: 2,
            totalLessons: 5,
            requiredLevel: 1
          },
          {
            id: "module-2",
            title: "Advanced Blob Storage Features",
            description: "Explore advanced features and best practices for Azure Blob Storage",
            completedLessons: 0,
            totalLessons: 4,
            requiredLevel: 2
          }
        ],
        recentActivity: [
          {
            id: "activity-1",
            description: "Completed Introduction to Azure Blob Storage",
            timestamp: new Date().toISOString(),
            type: "completion"
          },
          {
            id: "activity-2",
            description: "Started Advanced Blob Storage Features",
            timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            type: "start"
          }
        ]
      };

      res.json(progressData);
    } catch (error) {
      console.error("Error fetching training progress:", error);
      res.status(500).json({ error: "Failed to fetch training progress" });
    }
  });

  return httpServer;
}