import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { neon } from "@neondatabase/serverless";

async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is not set. Database will not be initialized.");
    return;
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      CREATE TABLE IF NOT EXISTS festivals (
        id VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("Database initialized");
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
}

const memoryStore = new Map<string, any>();

async function startServer() {
  await initDB();

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/festivals/:id", async (req, res) => {
    const { id } = req.params;
    try {
      if (process.env.DATABASE_URL) {
        const sql = neon(process.env.DATABASE_URL);
        const result = await sql`SELECT data FROM festivals WHERE id = ${id}`;
        if (result.length > 0) {
          res.json({ data: result[0].data });
        } else {
          res.status(404).json({ error: "Not found" });
        }
      } else {
        if (memoryStore.has(id)) {
          res.json({ data: memoryStore.get(id) });
        } else {
          res.status(404).json({ error: "Not found" });
        }
      }
    } catch (err) {
      console.error("GET /api/festivals/:id error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/festivals/:id", async (req, res) => {
    const { id } = req.params;
    const { data } = req.body;
    try {
      if (process.env.DATABASE_URL) {
        const sql = neon(process.env.DATABASE_URL);
        await sql`
          INSERT INTO festivals (id, data) 
          VALUES (${id}, ${JSON.stringify(data)}) 
          ON CONFLICT (id) 
          DO UPDATE SET data = ${JSON.stringify(data)}, updated_at = CURRENT_TIMESTAMP
        `;
      } else {
        memoryStore.set(id, data);
      }
      res.json({ success: true });
    } catch (err) {
      console.error("POST /api/festivals/:id error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
