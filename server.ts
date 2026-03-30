import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is not set. Database will not be initialized.");
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS festivals (
        id VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database initialized");
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
}

async function startServer() {
  await initDB();

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });

  const rooms = new Map<string, Set<WebSocket>>();
  const memoryStore = new Map<string, any>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;

    ws.on("message", async (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        
        if (parsed.type === "join") {
          const { festivalId } = parsed;
          currentRoom = festivalId;
          
          if (!rooms.has(festivalId)) {
            rooms.set(festivalId, new Set());
          }
          rooms.get(festivalId)!.add(ws);

          if (process.env.DATABASE_URL) {
            // Fetch current state from DB
            const result = await pool.query("SELECT data FROM festivals WHERE id = $1", [festivalId]);
            if (result.rows.length > 0) {
              ws.send(JSON.stringify({ type: "init", data: result.rows[0].data }));
            } else {
              ws.send(JSON.stringify({ type: "not_found" }));
            }
          } else if (memoryStore.has(festivalId)) {
            // Fallback to in-memory store
            ws.send(JSON.stringify({ type: "init", data: memoryStore.get(festivalId) }));
          } else {
            ws.send(JSON.stringify({ type: "not_found" }));
          }
        } else if (parsed.type === "update") {
          const { festivalId, data } = parsed;
          
          if (process.env.DATABASE_URL) {
            // Save to DB
            await pool.query(
              "INSERT INTO festivals (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = CURRENT_TIMESTAMP",
              [festivalId, JSON.stringify(data)]
            );
          } else {
            // Fallback to in-memory store
            memoryStore.set(festivalId, data);
          }

          // Broadcast to others in room
          const room = rooms.get(festivalId);
          if (room) {
            const msg = JSON.stringify({ type: "update", data });
            for (const client of room) {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(msg);
              }
            }
          }
        }
      } catch (err) {
        console.error("WebSocket message error:", err);
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
        }
      }
    });
  });
}

startServer();
