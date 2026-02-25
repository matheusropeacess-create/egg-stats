import "dotenv/config";
import pkg from "pg";

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // necessário para Supabase
});

export async function query(text, params) {
  return pool.query(text, params);
}
