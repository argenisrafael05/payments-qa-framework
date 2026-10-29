import { readdirSync, readFileSync } from "node:fs";
import mysql, {
  type Connection,
  type Pool,
  type RowDataPacket,
} from "mysql2/promise";
import type { Config, RegionConfig } from "./config.ts";

const migrations = new URL("../migrations/", import.meta.url);

export function createPool(config: Config): Pool {
  return mysql.createPool({ ...config.db, timezone: "Z" });
}

// PayRef owns its schema. In test mode it starts with an empty database, so every run starts clean.
export async function prepareDatabase(
  config: Config,
  region: RegionConfig,
): Promise<void> {
  const connection = await mysql.createConnection({
    ...config.db,
    multipleStatements: true,
  });
  try {
    if (config.mode === "test") {
      await dropAllTables(connection, config.db.database);
    }
    await applyMigrations(connection);
    await loadParticipants(connection, region);
  } finally {
    await connection.end();
  }
}

async function dropAllTables(
  connection: Connection,
  database: string,
): Promise<void> {
  const [tables] = await connection.query<RowDataPacket[]>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?",
    [database],
  );
  if (tables.length === 0) {
    return;
  }
  const names = tables
    .map((table) => mysql.escapeId(String(table.name)))
    .join(", ");
  await connection.query(
    `SET FOREIGN_KEY_CHECKS = 0; DROP TABLE ${names}; SET FOREIGN_KEY_CHECKS = 1;`,
  );
}

async function applyMigrations(connection: Connection): Promise<void> {
  await connection.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME(3) NOT NULL)",
  );
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT name FROM schema_migrations",
  );
  const applied = new Set(rows.map((row) => String(row.name)));

  const files = readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    await connection.query(readFileSync(new URL(file, migrations), "utf8"));
    await connection.query(
      "INSERT INTO schema_migrations (name, applied_at) VALUES (?, UTC_TIMESTAMP(3))",
      [file],
    );
  }
}

// Merchants and payment methods come from the region config, not from an admin API.
async function loadParticipants(
  connection: Connection,
  region: RegionConfig,
): Promise<void> {
  for (const merchant of region.merchants) {
    await connection.query(
      "INSERT INTO merchants (id, name) VALUES (?, ?) AS new ON DUPLICATE KEY UPDATE name = new.name",
      [merchant.id, merchant.name],
    );
  }
  for (const method of region.paymentMethods) {
    await connection.query(
      "INSERT INTO payment_methods (id, name, kind) VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE name = new.name, kind = new.kind",
      [method.id, method.name, method.kind],
    );
  }
}
