import "dotenv/config";
import pkg from "pg";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // IMPORTANTE para Supabase
});

async function test() {
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("✅ Conectado ao Supabase!");
    console.log(res.rows);
  } catch (err) {
    console.error("❌ Erro ao conectar:", err.message);
  } finally {
    await pool.end();
  }
}

test();