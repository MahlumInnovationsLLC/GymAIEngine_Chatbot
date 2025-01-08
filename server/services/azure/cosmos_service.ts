import { CosmosClient, Container, Database } from "@azure/cosmos";

let client: CosmosClient | null = null;
let database: Database | null = null;
let container: Container | null = null;

export async function initializeCosmosDB() {
  try {
    if (!process.env.AZURE_COSMOS_CONNECTION_STRING) {
      throw new Error("Azure Cosmos DB connection string not configured");
    }

    // Trim the connection string to remove any whitespace
    const connectionString = process.env.AZURE_COSMOS_CONNECTION_STRING.trim();

    if (!connectionString) {
      throw new Error("Azure Cosmos DB connection string is empty");
    }

    client = new CosmosClient(connectionString);

    // Create database if it doesn't exist
    const { database: db } = await client.databases.createIfNotExists({
      id: "GYMAIEngineDB"
    });
    database = db;

    // Create container if it doesn't exist with the specified partition key
    const { container: cont } = await database.containers.createIfNotExists({
      id: "chats",
      partitionKey: { paths: ["/userKey"] }
    });
    container = cont;

    console.log("Successfully connected to Azure Cosmos DB");
  } catch (error) {
    console.error("Error initializing Cosmos DB:", error);
    throw error;
  }
}

// Initialize on module load
initializeCosmosDB().catch(console.error);

// Helper function to check container availability
function ensureContainer() {
  if (!container) {
    throw new Error("Cosmos DB not initialized. Please check your connection.");
  }
  return container;
}

// Chat-specific operations
export async function createChat(chatData: any) {
  const cont = ensureContainer();

  try {
    // Add metadata fields
    const chatWithMetadata = {
      ...chatData,
      _ts: Math.floor(Date.now() / 1000),
      type: 'chat'
    };

    const { resource: createdChat } = await cont.items.create(chatWithMetadata);
    return createdChat;
  } catch (error: any) {
    if (error.code === 409) {
      // If document already exists, try to get it
      const { resource: existingChat } = await cont.item(chatData.id, chatData.userKey).read();
      return existingChat;
    }
    console.error("Error creating chat:", error);
    throw error;
  }
}

export async function getChat(userId: string, chatId: string) {
  const cont = ensureContainer();

  try {
    const { resource: chat } = await cont.item(chatId, userId).read();
    return chat;
  } catch (error: any) {
    if (error.code === 404) {
      return null;
    }
    console.error("Error retrieving chat:", error);
    throw error;
  }
}

export async function updateChat(userId: string, chatId: string, updates: any) {
  const cont = ensureContainer();

  try {
    const { resource: existingChat } = await cont.item(chatId, userId).read();

    if (!existingChat) {
      throw new Error("Chat not found");
    }

    const updatedChat = {
      ...existingChat,
      ...updates,
      _ts: Math.floor(Date.now() / 1000)
    };

    const { resource: result } = await cont.item(chatId, userId).replace(updatedChat);
    return result;
  } catch (error) {
    console.error("Error updating chat:", error);
    throw error;
  }
}

export async function deleteChat(userId: string, chatId: string) {
  const cont = ensureContainer();

  try {
    await cont.item(chatId, userId).delete();
  } catch (error) {
    console.error("Error deleting chat:", error);
    throw error;
  }
}

export async function listChats(userId: string) {
  const cont = ensureContainer();

  try {
    const querySpec = {
      query: "SELECT * FROM c WHERE c.type = 'chat' AND c.userKey = @userId ORDER BY c._ts DESC",
      parameters: [
        {
          name: "@userId",
          value: userId
        }
      ]
    };

    const { resources: chats } = await cont.items
      .query(querySpec)
      .fetchAll();

    return chats;
  } catch (error) {
    console.error("Error listing chats:", error);
    throw error;
  }
}