import mongoose from "mongoose";
import fs from "node:fs/promises";
import path from "node:path";
import { connectToDb, disconnectDb } from "./src/config/db.js";

async function backupDatabase() {
  await connectToDb();
  const db = mongoose.connection.db;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.resolve(import.meta.dirname, "backups", `pre_cleanup_backup_${timestamp}`);
  await fs.mkdir(backupDir, { recursive: true });

  console.log(`[Backup] Starting full backup of smart_bakery_db to:\n  ${backupDir}\n`);

  const collections = await db.listCollections().toArray();
  const summary = {};

  for (const col of collections) {
    const docs = await db.collection(col.name).find({}).toArray();
    const filePath = path.join(backupDir, `${col.name}.json`);
    await fs.writeFile(filePath, JSON.stringify(docs, null, 2), "utf-8");
    summary[col.name] = docs.length;
    console.log(`✔ Backed up ${docs.length.toString().padStart(4)} documents from '${col.name}' -> ${col.name}.json`);
  }

  const manifestPath = path.join(backupDir, "_manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    databaseName: mongoose.connection.name,
    totalCollections: collections.length,
    documentCounts: summary,
  }, null, 2), "utf-8");

  console.log(`\n✔ [Backup Complete] Successfully backed up all ${collections.length} collections.`);
  await disconnectDb();
  return backupDir;
}

backupDatabase().catch(console.error);
