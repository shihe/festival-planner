import { neon } from '@neondatabase/serverless';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  const idString = Array.isArray(id) ? id[0] : id;
  
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "DATABASE_URL is not set" });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS festivals (
        id VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    if (req.method === 'GET') {
      const result = await sql`SELECT data FROM festivals WHERE id = ${idString}`;
      if (result.length > 0) {
        res.status(200).json({ data: result[0].data });
      } else {
        res.status(404).json({ error: "Not found" });
      }
    } else if (req.method === 'POST') {
      const { data } = req.body;
      await sql`
        INSERT INTO festivals (id, data) 
        VALUES (${idString}, ${JSON.stringify(data)}) 
        ON CONFLICT (id) 
        DO UPDATE SET data = ${JSON.stringify(data)}, updated_at = CURRENT_TIMESTAMP
      `;
      res.status(200).json({ success: true });
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (err) {
    console.error("API error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
