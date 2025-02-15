import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { CosmosClient, Container } from "@azure/cosmos";
import { ContainerClient } from "@azure/storage-blob";
import multer from "multer";
import { v4 as uuidv4 } from 'uuid';
import supportRouter from "./routes/support";
import { db } from "@db";
import {
  documentWorkflows,
  documentApprovals,
  documentPermissions,
  roles,
  userTraining,
  aiEngineActivity,
  trainingModules,
} from "@db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { setupWebSocketServer } from "./services/websocket";
import { generateReport } from "./services/document-generator";
import { listChats } from "./services/azure/cosmos_service";
import { analyzeDocument, checkOpenAIConnection } from "./services/azure/openai_service";
import type { Request, Response } from "express";
import { getStorageMetrics, getRecentActivity } from "./services/azure/blob_service";
import adminRouter from "./routes/admin";

// Types
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
  };
}

interface PerplexityResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  citations?: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  mode?: 'chat' | 'web-search';
  citations?: string[];
}

interface Equipment {
  id: string;
  name: string;
  type: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  yearManufactured: number;
  lastMaintenanceDate?: Date;
  nextMaintenanceDate?: Date;
  status: 'active' | 'maintenance' | 'retired';
}

interface EquipmentType {
  id: string;
  manufacturer: string;
  model: string;
  type: string;
}

// Initialize Azure Blob Storage Client with SAS token
const sasUrl = "https://gymaidata.blob.core.windows.net/documents?sp=racwdli&st=2025-01-09T20:30:31Z&se=2026-01-02T04:30:31Z&spr=https&sv=2022-11-02&sr=c&sig=eCSIm%2B%2FjBLs2DjKlHicKtZGxVWIPihiFoRmld2UbpIE%3D";

if (!sasUrl) {
  throw new Error("Azure Blob Storage SAS URL not found");
}

let containerClient: ContainerClient;
let equipmentContainer: Container;
let equipmentTypeContainer: Container;

// Helper Functions
async function initializeContainers() {
  const { database } = await import("./services/azure/cosmos_service");
  if (!database) {
    throw new Error("Failed to initialize database");
  }
  equipmentContainer = database.container('equipment');
  equipmentTypeContainer = database.container('equipment-types');
}

async function searchWithPerplexity(content: string): Promise<PerplexityResponse> {
  if (!process.env.PERPLEXITY_API_KEY) {
    console.error("Perplexity API key missing");
    throw new Error("Perplexity API key not found in environment variables");
  }

  try {
    console.log("Making request to Perplexity API with content:", content);
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-sonar-small-128k-online",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that provides factual answers based on web search results. Be precise and concise."
          },
          {
            role: "user",
            content
          }
        ],
        temperature: 0.2,
        top_p: 0.9,
        stream: false
      })
    });

    console.log("Perplexity API response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Perplexity API error response:", errorText);
      throw new Error(`Perplexity API responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("Perplexity API response data:", JSON.stringify(data, null, 2));

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No choices returned from Perplexity API");
    }

    return {
      choices: data.choices,
      citations: data.citations || []
    };
  } catch (error) {
    console.error("Error in searchWithPerplexity:", error);
    throw new Error(`Failed to get web search results: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function trackAIEngineUsage(userId: string, feature: "chat" | "web_search" | "document_analysis" | "equipment_prediction" | "report_generation", durationMinutes: number, metadata?: Record<string, any>) {
  try {
    await db
      .insert(aiEngineActivity)
      .values({
        userId,
        sessionId: uuidv4(),
        feature,
        startTime: new Date(),
        endTime: new Date(Date.now() + durationMinutes * 60000),
        durationMinutes,
        metadata: metadata || {}
      });
  } catch (error) {
    console.warn("Failed to track AI usage:", error);
  }
}

async function getUserTrainingLevel(userId: string) {
  const trainings = await db
    .select()
    .from(userTraining)
    .where(eq(userTraining.userId, userId));

  const completedModules = trainings.filter(t => t.status === 'completed').length;
  return Math.floor(completedModules / 3) + 1;
}

// Equipment Type Operations
async function getEquipmentType(manufacturer: string, model: string): Promise<EquipmentType | null> {
  try {
    const querySpec = {
      query: "SELECT * FROM c WHERE c.manufacturer = @manufacturer AND c.model = @model",
      parameters: [
        { name: "@manufacturer", value: manufacturer },
        { name: "@model", value: model }
      ]
    };

    const { resources } = await equipmentTypeContainer.items.query(querySpec).fetchAll();
    return resources[0] || null;
  } catch (error) {
    console.error("Error fetching equipment type:", error);
    return null;
  }
}

async function createEquipmentType(data: Partial<EquipmentType>): Promise<EquipmentType> {
  const newType: EquipmentType = {
    id: uuidv4(),
    manufacturer: data.manufacturer || '',
    model: data.model || '',
    type: data.type || ''
  };

  const { resource } = await equipmentTypeContainer.items.create(newType);
  if (!resource) {
    throw new Error("Failed to create equipment type");
  }
  return resource;
}

// Equipment Operations
async function getAllEquipment(): Promise<Equipment[]> {
  try {
    const querySpec = {
      query: "SELECT * FROM c"
    };

    const { resources } = await equipmentContainer.items.query(querySpec).fetchAll();
    return resources;
  } catch (error) {
    console.error("Error fetching all equipment:", error);
    return [];
  }
}

async function createEquipment(data: Partial<Equipment>): Promise<Equipment> {
  const newEquipment: Equipment = {
    id: uuidv4(),
    name: data.name || '',
    type: data.type || '',
    manufacturer: data.manufacturer || '',
    model: data.model || '',
    serialNumber: data.serialNumber || '',
    yearManufactured: data.yearManufactured || new Date().getFullYear(),
    lastMaintenanceDate: data.lastMaintenanceDate,
    nextMaintenanceDate: data.nextMaintenanceDate,
    status: data.status || 'active'
  };

  const { resource } = await equipmentContainer.items.create(newEquipment);
  if (!resource) {
    throw new Error("Failed to create equipment");
  }
  return resource;
}

async function updateEquipment(id: string, updates: Partial<Equipment>): Promise<Equipment | null> {
  try {
    const { resource: existingItem } = await equipmentContainer.item(id, id).read();
    const updatedItem = { ...existingItem, ...updates };
    const { resource } = await equipmentContainer.item(id, id).replace(updatedItem);
    return resource;
  } catch (error) {
    console.error("Error updating equipment:", error);
    return null;
  }
}

export function registerRoutes(app: Express): Server {
  console.log("Creating Container Client with SAS token...");
  containerClient = new ContainerClient(sasUrl);
  console.log("Successfully created Container Client");

  // Configure multer for memory storage
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    }
  });

  // Initialize Cosmos DB containers
  const httpServer = createServer(app);
  const wsServer = setupWebSocketServer(httpServer);

  // Add user authentication middleware
  app.use((req: AuthenticatedRequest, res, next) => {
    req.user = { id: '1', username: 'test_user' };
    const userId = req.headers['x-user-id'];
    if (userId && typeof userId === 'string') {
      wsServer.broadcast([userId], { type: 'USER_ACTIVE' });
    }
    next();
  });

  // Register API routes with proper prefixes
  app.use('/api/support', supportRouter);
  app.use('/api/admin', adminRouter);

  // Add uploads directory for serving generated files
  app.use('/uploads', express.static('uploads'));

  // Messages endpoint
  app.post("/api/messages", async (req, res) => {
    console.log("Received message request:", req.body);
    try {
      const { content, mode = 'chat' } = req.body;

      if (!content) {
        console.log("Missing content in request");
        return res.status(400).json({ error: "Content is required" });
      }

      // Generate user message
      const userMessage: Message = {
        id: uuidv4(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        mode
      };

      let aiResponse: string | undefined;
      let citations: string[] | undefined;

      if (mode === 'web-search') {
        try {
          console.log("Starting web search with content:", content);
          const perplexityResponse = await searchWithPerplexity(content);
          console.log("Web search response received:", perplexityResponse);

          if (perplexityResponse.choices && perplexityResponse.choices.length > 0) {
            aiResponse = perplexityResponse.choices[0]?.message?.content;
            citations = perplexityResponse.citations;
            console.log("Extracted response:", { aiResponse, citations });
          } else {
            throw new Error("No response content received from Perplexity");
          }

          await trackAIEngineUsage(req.user?.id || 'anonymous', 'web_search', 1, { messageLength: content.length });
        } catch (error) {
          console.error("Error in web search mode:", error);
          throw error;
        }
      } else {
        try {
          console.log("Starting chat mode with content:", content);
          aiResponse = await analyzeDocument(content);
          await trackAIEngineUsage(req.user?.id || 'anonymous', 'chat', 0.5, { messageLength: content.length });
        } catch (error) {
          console.error("Error in chat mode:", error);
          throw error;
        }
      }

      // Create AI message
      const aiMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: aiResponse || "I apologize, but I'm having trouble understanding your request. Could you please rephrase it?",
        createdAt: new Date().toISOString(),
        mode,
        citations
      };

      console.log("Returning messages:", [userMessage, aiMessage]);
      res.json([userMessage, aiMessage]);
    } catch (error) {
      console.error("Error processing message:", error);
      res.status(500).json({
        error: "Failed to process message",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Update online users endpoint
  app.get("/api/users/online-status", (req, res) => {
    const activeUsers = wsServer.getActiveUsers();
    res.json(activeUsers);
  });

  // Equipment Types endpoints
  app.post("/api/equipment-types", async (req, res) => {
    try {
      const type = req.body;
      const existingType = await getEquipmentType(type.manufacturer, type.model);

      if (existingType) {
        return res.json(existingType);
      }

      const newType = await createEquipmentType(type);
      res.json(newType);
    } catch (error) {
      console.error("Error creating equipment type:", error);
      res.status(500).json({ error: "Failed to create equipment type" });
    }
  });

  // Equipment endpoints
  app.get("/api/equipment", async (req, res) => {
    try {
      const equipment = await getAllEquipment();
      res.json(equipment);
    } catch (error) {
      console.error("Error getting equipment:", error);
      res.status(500).json({ error: "Failed to get equipment" });
    }
  });

  app.post("/api/equipment", async (req, res) => {
    try {
      const equipmentData = req.body;
      const newEquipment = await createEquipment(equipmentData);
      res.json(newEquipment);
    } catch (error) {
      console.error("Error creating equipment:", error);
      res.status(500).json({ error: "Failed to create equipment" });
    }
  });

  app.patch("/api/equipment/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const updatedEquipment = await updateEquipment(id, updates);
      if (!updatedEquipment) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      res.json(updatedEquipment);
    } catch (error) {
      console.error("Error updating equipment:", error);
      res.status(500).json({ error: "Failed to update equipment" });
    }
  });


  // Add generate detailed report endpoint
  app.post("/api/generate-report", async (req, res) => {
    try {
      const { topic } = req.body;

      if (!topic) {
        return res.status(400).json({ error: "Topic is required" });
      }

      console.log(`Generating report for topic: ${topic}`);
      const filename = await generateReport(topic);

      if (!filename) {
        throw new Error("Failed to generate report");
      }

      // Track AI usage for report generation (assuming it takes about 2 minutes)
      await trackAIEngineUsage(req.user!.id, 'report_generation', 2, { topic });

      res.json({
        success: true,
        filename,
        downloadUrl: `/uploads/${filename}`
      });
    } catch (error) {
      console.error("Error generating report:", error);
      res.status(500).json({
        error: "Failed to generate report",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });


  // Check Azure OpenAI connection status
  app.get("/api/azure/status", async (req, res) => {
    try {
      console.log("Checking Azure services status...");
      const status = await checkOpenAIConnection();
      res.json(status);
    } catch (error) {
      console.error("Error checking Azure OpenAI status:", error);
      res.status(500).json({
        status: "error",
        message: "Failed to check Azure OpenAI status",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Add dashboard metrics endpoint
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const [storageMetrics, azureStatus] = await Promise.all([
        getStorageMetrics(),
        checkOpenAIConnection()
      ]);

      const stats = {
        totalDocuments: storageMetrics.totalDocuments,
        totalStorageSize: storageMetrics.totalSize,
        documentTypes: storageMetrics.documentTypes,
        aiServiceStatus: azureStatus.some(s => s.name === "Azure OpenAI" && s.status === "connected"),
        storageStatus: azureStatus.some(s => s.name === "Azure Blob Storage" && s.status === "connected"),
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard statistics" });
    }
  });

  app.get("/api/dashboard/activity", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const recentActivity = await getRecentActivity(limit);
      res.json(recentActivity);
    } catch (error) {
      console.error("Error fetching activity:", error);
      res.status(500).json({ error: "Failed to fetch activity" });
    }
  });

  // Dashboard extended stats endpoint
  app.get("/api/dashboard/extended-stats", async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).send("Not authenticated");
      }

      const userId = req.user.id;

      // Get user's training level
      const trainingLevel = await getUserTrainingLevel(userId);

      // Get AI Engine usage statistics for the past 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const aiActivities = await db
        .select({
          date: aiEngineActivity.startTime,
          duration: aiEngineActivity.durationMinutes,
        })
        .from(aiEngineActivity)
        .where(
          and(
            eq(aiEngineActivity.userId, userId),
            gte(aiEngineActivity.startTime, sevenDaysAgo),
            lte(aiEngineActivity.startTime, new Date())
          )
        );

      // Initialize all days in the past week with 0
      const dailyUsage = new Map<string, number>();
      for (let i = 0; i < 7; i++) {
        const date = new Date(sevenDaysAgo);
        date.setDate(date.getDate() + i);
        dailyUsage.set(date.toISOString().split('T')[0], 0);
      }

      // Add actual usage data
      aiActivities.forEach(activity => {
        const day = activity.date.toISOString().split('T')[0];
        const duration = parseFloat(activity.duration?.toString() || "0");
        dailyUsage.set(day, (dailyUsage.get(day) || 0) + duration);
      });

      const extendedStats = {
        collaborators: 5, // Placeholder until user management is implemented
        chatActivity: {
          totalResponses: 0,
          downloadedReports: 0
        },
        trainingLevel,
        incompleteTasks: 0,
        aiEngineUsage: Array.from(dailyUsage.entries()).map(([date, minutes]) => ({
          date,
          minutes: Math.round(minutes * 100) / 100
        })).sort((a, b) => a.date.localeCompare(b.date))
      };

      // Get activity logs to count chat responses and downloaded reports
      try {
        const activityLogs = await getRecentActivity(100); // Get last 100 activities
        for (const activity of activityLogs) {
          if (activity.type === 'download' && activity.documentName.includes('report')) {
            extendedStats.chatActivity.downloadedReports++;
          } else if (activity.type === 'view' && activity.documentName.includes('chat')) {
            extendedStats.chatActivity.totalResponses++;
          }
        }
      } catch (error) {
        console.warn("Error counting activity logs:", error);
        // Continue with default values if activity logs can't be counted
      }

      res.json(extendedStats);
    } catch (error) {
      console.error("Error fetching extended stats:", error);
      res.status(500).json({ error: "Failed to fetch extended statistics" });
    }
  });

  // Chat history endpoint
  app.get("/api/chats", async (req, res) => {
    try {
      const userKey = 'default_user';
      const chats = await listChats(userKey);
      const formattedChats = chats.map(chat => ({
        id: chat.id,
        title: chat.title,
        lastMessageAt: chat.lastMessageAt,
        isArchived: chat.isDeleted || false
      }));
      res.json(formattedChats);
    } catch (error) {
      console.error("Error fetching chats:", error);
      res.status(500).json({ error: "Failed to fetch chats" });
    }
  });

  // Blob Storage endpoints
  app.get("/api/documents/browse", async (req, res) => {
    try {
      console.log("Listing blobs from container:", "documents");
      const path = (req.query.path as string) || "";
      console.log("Browsing path:", path);

      // List all blobs in the path
      const items = [];
      const listOptions = {
        prefix: path,
        delimiter: '/'
      };

      // Get all blobs with the specified prefix
      const blobs = containerClient.listBlobsByHierarchy('/', listOptions);

      console.log("Starting blob enumeration...");
      for await (const item of blobs) {
        console.log("Found item:", item.kind === "prefix" ? "Directory:" : "File:", item.name);

        // Check if it's a virtual directory (folder)
        if (item.kind === "prefix") {
          // Get folder name by removing the trailing slash
          const folderPath = item.name;
          const folderName = folderPath.split('/').filter(Boolean).pop() || "";

          items.push({
            name: folderName,
            path: folderPath,
            type: "folder"
          });
        } else {
          // It's a blob (file)
          const blobItem = item;
          const fileName = blobItem.name.split("/").pop() || "";

          // Don't include folder markers
          if (!fileName.startsWith('.folder')) {
            items.push({
              name: fileName,
              path: blobItem.name,
              type: "file",
              size: blobItem.properties?.contentLength,
              lastModified: blobItem.properties?.lastModified?.toISOString()
            });
          }
        }
      }

      console.log("Found items:", items);
      res.json(items);
    } catch (error) {
      console.error("Error listing blobs:", error);
      res.status(500).json({ error: "Failed to list documents" });
    }
  });

  app.post("/api/documents/upload", upload.array('files'), async (req, res) => {
    try {
      const path = req.body.path || "";
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files provided" });
      }

      console.log("Uploading files to container:", "documents", "path:", path);
      console.log("Files to upload:", files.map(f => f.originalname));

      const uploadPromises = files.map(async (file) => {
        const blobName = path ? `${path}/${file.originalname}` : file.originalname;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.uploadData(file.buffer);
        return blobName;
      });

      const uploadedFiles = await Promise.all(uploadPromises);
      console.log("Successfully uploaded files:", uploadedFiles);

      res.json({ message: "Files uploaded successfully", files: uploadedFiles });
    } catch (error) {
      console.error("Error uploading files:", error);
      res.status(500).json({ error: "Failed to upload files" });
    }
  });

  // Add folder creation endpoint
  app.post("/api/documents/folders", async (req, res) => {
    try {
      const { path } = req.body;

      if (!path) {
        return res.status(400).json({ error: "Path is required" });
      }

      console.log("Creating folder:", path);

      // Create a zero-length blob with the folder name as prefix
      const folderPath = path.endsWith('/') ? path : `${path}/`;
      const blockBlobClient = containerClient.getBlockBlobClient(`${folderPath}.folder`);
      await blockBlobClient.uploadData(Buffer.from(''));

      console.log("Successfully created folder:", path);
      res.json({ message: "Folder created successfully", path });
    } catch (error) {
      console.error("Error creating folder:", error);
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  // Add new endpoint to get user's training level
  app.get("/api/training/level", async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).send("Not authenticated");
      }

      const trainingLevel = await getUserTrainingLevel(req.user.id);
      res.json(trainingLevel);
    } catch (error) {
      console.error("Error getting training level:", error);
      res.status(500).json({ error: "Failed to get training level" });
    }
  });

  // Update training progress endpoint
  app.post("/api/training/progress", async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).send("Not authenticated");
      }

      const { moduleId, progress, status } = req.body;

      // Update the training progress
      await db
        .insert(userTraining)
        .values({
          userId: req.user.id,
          moduleId,
          progress,
          status,
          assignedBy: req.user.id,
        })
        .onConflictDoUpdate({
          target: [userTraining.userId, userTraining.moduleId],
          set: {
            progress,
            status,
            completedAt: status === 'completed' ? new Date() : undefined,
          },
        });

      // Broadcast the updated training level
      await wsServer.broadcastTrainingLevel(req.user.id);

      res.json({ message: "Training progress updated successfully" });
    } catch (error) {
      console.error("Error updating training progress:", error);
      res.status(500).json({ error: "Failed to update training progress" });
    }
  });

  // Add document content endpoint
  app.get("/api/documents/:path*/content", async (req, res) => {
    try {
      const documentPath = decodeURIComponent(req.params.path + (req.params[0] || ''));
      console.log("Fetching document content for:", documentPath);

      const blockBlobClient = containerClient.getBlockBlobClient(documentPath);

      try {
        const downloadResponse = await blockBlobClient.download();
        const properties = await blockBlobClient.getProperties();

        if (!downloadResponse.readableStreamBody) {
          return res.status(404).json({ error: "No content available" });
        }

        // Read the stream into a buffer
        const chunks: Buffer[] = [];
        for await (const chunk of downloadResponse.readableStreamBody) {
          chunks.push(Buffer.from(chunk));
        }
        const content = Buffer.concat(chunks).toString('utf-8');

        res.json({
          content,
          revision: properties.metadata?.revision,
        });
      } catch (error: any) {
        if (error.statusCode === 404) {
          return res.status(404).json({ error: "Document not found" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error fetching document content:", error);
      res.status(500).json({ error: "Failed to fetch document content" });
    }
  });

  // Add document content update endpoint
  app.put("/api/documents/:path*/content", async (req, res) => {
    try {
      const documentPath = decodeURIComponent(req.params.path + (req.params[0] || ''));
      const { content, revision } = req.body;

      if (!content) {
        return res.status(400).json({ error: "Content is required" });
      }

      console.log("Updating document content for:", documentPath);

      const blockBlobClient = containerClient.getBlockBlobClient(documentPath);

      // Add revision information as metadata
      const metadata = revision ? { revision } : undefined;

      await blockBlobClient.upload(content, content.length, {
        metadata,
        blobHTTPHeaders: {
          blobContentType: "text/html",
        },
      });

      res.json({ message: "Document updated successfully" });
    } catch (error) {
      console.error("Error updating document content:", error);
      res.status(500).json({ error: "Failed to update document content" });
    }
  });

  // Add workflow endpoint
  app.post("/api/documents/workflow", async (req, res) => {
    try {
      const { documentId, type, assigneeId } = req.body;

      if (!documentId || !type || !assigneeId) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Create workflow entry
      const [workflow] = await db
        .insert(documentWorkflows)
        .values({
          documentId: parseInt(documentId),
          status: 'active',
          startedAt: new Date(),
        })
        .returning();

      // Create approval entry
      await db
        .insert(documentApprovals)
        .values({
          documentId: parseInt(documentId),
          version: '1.0', // This should come from the document metadata
          approverUserId: assigneeId,
          status: 'pending',
        });

      // TODO: Send email notification
      // This would integrate with your email service

      res.json({
        message: `Document sent for ${type}`,
        workflowId: workflow.id,
      });
    } catch (error) {
      console.error("Error creating workflow:", error);
      res.status(500).json({ error: "Failed to create workflow" });
    }
  });

  // Add workflow status endpoint
  app.get("/api/documents/workflow/:documentId", async (req, res) => {
    try {
      const documentId = parseInt(req.params.documentId);

      const [latestWorkflow] = await db
        .select({
          status: documentWorkflows.status,
          startedAt: documentWorkflows.startedAt,
          completedAt: documentWorkflows.completedAt,
        })
        .from(documentWorkflows)
        .where(eq(documentWorkflows.documentId, documentId))
        .orderBy(documentWorkflows.startedAt, 'desc')
        .limit(1);

      if (!latestWorkflow) {
        return res.json({
          status: 'draft',
          updatedAt: new Date().toISOString(),
        });
      }

      const [latestApproval] = await db
        .select()
        .from(documentApprovals)
        .where(eq(documentApprovals.documentId, documentId))
        .orderBy(documentApprovals.createdAt, 'desc')
        .limit(1);

      res.json({
        status: latestApproval?.status || 'draft',
        reviewedBy: latestApproval?.approverUserId,
        approvedBy: latestApproval?.status === 'approved' ? latestApproval.approverUserId : undefined,
        updatedAt: latestWorkflow.startedAt.toISOString(),
      });
    } catch (error) {
      console.error("Error fetching workflow status:", error);
      res.status(500).json({ error: "Failed to fetch workflow status" });
    }
  });

  // Add workflow action endpoint (for handling review/approve actions)
  app.post("/api/documents/workflow/:documentId/action", async (req, res) => {
    try {
      const documentId = parseInt(req.params.documentId);
      const { action, userId, comments } = req.body;

      if (!documentId || !action || !userId) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Update approval status
      await db
        .update(documentApprovals)
        .set({
          status: action,
          comments,
          approvedAt: action === 'approved' ? new Date() : undefined,
        })
        .where(eq(documentApprovals.documentId, documentId))
        .where(eq(documentApprovals.approverUserId, userId));

      // If approved, update workflow status
      if (action === 'approved') {
        await db
          .update(documentWorkflows)
          .set({
            status: 'completed',
            completedAt: new Date(),
          })
          .where(eq(documentWorkflows.documentId, documentId));
      }

      res.json({
        message: `Document ${action} successfully`,
      });
    } catch (error) {
      console.error("Error updating workflow status:", error);
      res.status(500).json({ error: "Failed to update workflow status" });
    }
  });

  // Add document permissions endpoints
  app.get("/api/documents/:documentId/permissions", async (req, res) => {
    try {
      const documentId = parseInt(req.params.documentId);

      const permissions = await db
        .select()
        .from(documentPermissions)
        .where(eq(documentPermissions.documentId, documentId));

      // Enhance permissions with detailed access information
      const enhancedPermissions = permissions.map(permission => ({
        id: permission.id,
        roleLevel: permission.roleLevel,
        permissions: {
          view: true, // Base level permission
          edit: permission.roleLevel >= 2,
          review: permission.roleLevel >= 3,
          approve: permission.roleLevel >= 4,
          manage: permission.roleLevel >= 5,
        }
      }));

      res.json(enhancedPermissions);
    } catch (error) {
      console.error("Error fetching document permissions:", error);
      res.status(500).json({ error: "Failed to fetch permissions" });
    }
  });

  app.post("/api/documents/:documentId/permissions", async (req, res) => {
    try {
      const documentId = parseInt(req.params.documentId);
      const { roleLevel } = req.body;

      if (!roleLevel) {
        return res.status(400).json({ error: "Role level is required" });
      }

      // Check if permission already exists
      const [existingPermission] = await db
        .select()
        .from(documentPermissions)
        .where(
          and(
            eq(documentPermissions.documentId, documentId),
            eq(documentPermissions.roleLevel, roleLevel)
          )
        );

      if (existingPermission) {
        return res.status(400).json({ error: "Permission already exists for this role level" });
      }

      // Add new permission
      const [permission] = await db
        .insert(documentPermissions)
        .values({
          documentId,
          roleLevel,
        })
        .returning();

      res.json(permission);
    } catch (error) {
      console.error("Error adding document permission:", error);
      res.status(500).json({ error: "Failed to add permission" });
    }
  });

  app.patch("/api/documents/:documentId/permissions/:permissionId", async (req, res) => {
    try {
      const permissionId = parseInt(req.params.permissionId);
      const updates = req.body;

      // Update permission
      const [updatedPermission] = await db
        .update(documentPermissions)
        .set(updates)
        .where(eq(documentPermissions.id, permissionId))
        .returning();

      res.json(updatedPermission);
    } catch (error) {
      console.error("Error updating document permission:", error);
      res.status(500).json({ error: "Failed to update permission" });
    }
  });

  // Add roles endpoint
  app.get("/api/roles", async (req, res) => {
    try {
      const allRoles = await db
        .select()
        .from(roles)
        .orderBy(roles.level);

      res.json(allRoles);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  });

  // Add training module creation endpoint
  app.post("/api/training/modules", async (req: AuthenticatedRequest, res) => {
    try {
      const { title, description, content, questions } = req.body;

      if (!req.user) {
        return res.status(401).send("Not authenticated");
      }

      // Create the training module
      const [module] = await db
        .insert(trainingModules)
        .values({
          title,
          description,
          content,
          questions,
          createdBy: req.user.id,
          status: 'active',
          createdAt: new Date(),
        })
        .returning();

      // Update the user's training progress
      await db
        .insert(userTraining)
        .values({
          userId: req.user.id,
          moduleId: module.id,
          progress: 0,
          status: 'not_started',
          assignedBy: req.user.id,
        });

      res.json(module);
    } catch (error) {
      console.error("Error creating training module:", error);
      res.status(500).json({ error: "Failed to create module" });
    }
  });

  // Initialize Cosmos DB containers
  initializeContainers().catch(console.error);

  // Add report generation endpoint with proper Azure Blob Storage integration
  app.post("/api/reports/upload", upload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      const { title } = req.body;

      if (!file) {
        return res.status(400).json({ error: "No file provided" });
      }

      console.log("Uploading report to Azure Blob Storage:", title);

      // Generate a unique blob name for the report
      const blobName = `reports/${Date.now()}-${title.toLowerCase().replace(/\s+/g, '-')}.docx`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      // Upload to Azure Blob Storage
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: {
          blobContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
      });

      // Get the download URL (this will be a SAS URL that expires)
      const downloadUrl = `/api/reports/download/${encodeURIComponent(blobName)}`;

      console.log("Report uploaded successfully:", blobName);
      res.json({ downloadUrl });
    } catch (error) {
      console.error("Error uploading report:", error);
      res.status(500).json({ error: "Failed to upload report" });
    }
  });

  // Add download endpoint for reports
  app.get("/api/reports/download/:blobName", async (req: Request, res: Response) => {
    try {
      const blobName = decodeURIComponent(req.params.blobName);
      console.log("Downloading report:", blobName);

      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      const downloadResponse = await blockBlobClient.download(0);

      if (!downloadResponse.readableStreamBody) {
        return res.status(404).json({ error: "Report not found" });
      }

      // Set response headers
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${blobName.split('/').pop()}"`);

      // Pipe the stream to the response
      downloadResponse.readableStreamBody.pipe(res);
    } catch (error) {
      console.error("Error downloading report:", error);
      res.status(500).json({ error: "Failed to download report" });
    }
  });

  return httpServer;
}