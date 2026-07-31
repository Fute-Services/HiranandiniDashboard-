import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { neon } from "@neondatabase/serverless";

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL(_UNPOOLED) not set — run with --env-file=.env.local");

const sql = neon(url);
const schema = readFileSync(path.join(dir, "schema.sql"), "utf8");
const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
  console.log("Ran:", statement.split("\n")[0].slice(0, 60), "...");
}

console.log(`Done — ${statements.length} statements applied.`);
