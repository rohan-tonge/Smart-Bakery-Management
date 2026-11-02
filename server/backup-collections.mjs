import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart_bakery_db";
const DB_NAME = process.env.MONGO_DB_NAME || "smart_bakery_db";

const BACKUP_DIR = path.join(process.cwd(), "backups", "backup_20261029_pre_cleanup");

async function backup() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log(`Connected to database for backup: ${mongoose.connection.name}`);

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const collections = [
    "orders",
    "productionbatches",
    "ingredientrequisitions",
    "products",
    "recipes",
    "inventorylots",
    "ingredients",
    "categories",
    "users",
    "payments",
    "paymentproofs",
    "notifications",
  ];

  const manifest = {
    timestamp: new Date().toISOString(),
    database: DB_NAME,
    collections: {},
  };

  console.log(`Starting backup to: ${BACKUP_DIR}\n`);

  for (const colName of collections) {
    const col = mongoose.connection.collection(colName);
    const docs = await col.find({}).toArray();
    const filePath = path.join(BACKUP_DIR, `${colName}.json`);
    
    fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), "utf8");
    
    // Immediate verification of backup file
    const readBack = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (readBack.length !== docs.length) {
      throw new Error(`Backup verification failed for ${colName}: Source had ${docs.length}, backup has ${readBack.length}`);
    }

    manifest.collections[colName] = {
      recordCount: docs.length,
      fileSize: fs.statSync(filePath).size,
      verified: true,
    };

    console.log(`✓ [${colName}]: Backed up and verified ${docs.length} records (${manifest.collections[colName].fileSize} bytes)`);
  }

  const manifestPath = path.join(BACKUP_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n✓ Backup complete and verified! Manifest written to ${manifestPath}`);

  await mongoose.disconnect();
}

backup().catch(err => {
  console.error("Backup failed:", err);
  process.exit(1);
});
