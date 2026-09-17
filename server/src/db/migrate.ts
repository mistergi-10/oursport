import { migrate } from "drizzle-orm/node-postgres/migrator";

import { getDatabase } from "./client.js";

async function main() {
	await migrate(getDatabase(), { migrationsFolder: "./drizzle" });
}

void main();