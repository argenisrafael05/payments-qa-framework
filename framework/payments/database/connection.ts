import mysql, { type Pool } from "mysql2/promise";
import type { Environment } from "../environment.ts";

// The framework reads PayRef's database with a user that can only read.
export function connect(database: Environment["database"]): Pool {
  return mysql.createPool({
    ...database,
    timezone: "Z",
    connectTimeout: 5_000,
    connectionLimit: 2,
  });
}
