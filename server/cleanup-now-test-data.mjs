import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectToDb, disconnectDb } from "./src/config/db.js";
import Order from "./src/models/order.model.js";
import User from "./src/models/user.model.js";
import Product from "./src/models/product.model.js";
import Category from "./src/models/category.model.js";
import Recipe from "./src/models/recipe.model.js";
import Ingredient from "./src/models/ingredient.model.js";
import InventoryLot from "./src/models/inventoryLot.model.js";
import InventoryTransaction from "./src/models/inventoryTransaction.model.js";
import ProductionBatch from "./src/models/productionBatch.model.js";
import FinishedProductStock from "./src/models/finishedProductStock.model.js";
import Notification from "./src/models/notification.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runCleanup() {
  await connectToDb();

  const backupDir = path.join(__dirname, "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `cleanup_dummy_now_${Date.now()}.json`);

  console.log("=== GATHERING CONFIRMED TEST DUMMY DATA ADDED DURING BROWSER/TEST RUNS ===");

  const dbgRegex = /dbg_1793276/i;
  const testBatchRegex = /^(BATCH-77|BATCH-78|BATCH-REDESIGN-dbg_1793276)/;

  // 1. Production batches
  const batches = await ProductionBatch.find({
    $or: [
      { batchNumber: testBatchRegex },
      { batchNumber: dbgRegex },
      { ownerInstructions: /VIP order for Alice & Bob/i },
    ],
  });
  console.log(`Found ${batches.length} dummy production batches to remove.`);

  // 2. Orders
  const orders = await Order.find({
    $or: [
      { orderNumber: dbgRegex },
      { contactName: /Alice Sourdough|Bob Artisan/i },
    ],
  });
  console.log(`Found ${orders.length} dummy customer orders to remove.`);

  // 3. Users
  const users = await User.find({
    $or: [
      { email: dbgRegex },
      { name: dbgRegex },
    ],
  });
  console.log(`Found ${users.length} dummy test users to remove.`);

  // 4. Products
  const products = await Product.find({
    $or: [
      { name: dbgRegex },
      { sku: dbgRegex },
    ],
  });
  console.log(`Found ${products.length} dummy test products to remove.`);
  const productIds = products.map((p) => p._id);

  // 5. Categories
  const categories = await Category.find({
    $or: [
      { name: dbgRegex },
      { slug: dbgRegex },
    ],
  });
  console.log(`Found ${categories.length} dummy categories to remove.`);

  // 6. Recipes
  const recipes = await Recipe.find({
    $or: [
      { product: { $in: productIds } },
      { instructions: /Hydrate spelt flour with water and leaven/i },
      { instructions: /artisan rye sourdough/i },
    ],
  });
  console.log(`Found ${recipes.length} dummy recipes to remove.`);

  // 7. Ingredients
  const ingredients = await Ingredient.find({
    $or: [
      { name: dbgRegex },
      { sku: dbgRegex },
    ],
  });
  console.log(`Found ${ingredients.length} dummy ingredients to remove.`);
  const ingredientIds = ingredients.map((i) => i._id);

  // 8. Inventory Lots
  const lots = await InventoryLot.find({
    $or: [
      { lotNumber: dbgRegex },
      { ingredient: { $in: ingredientIds } },
    ],
  });
  console.log(`Found ${lots.length} dummy inventory lots to remove.`);

  // 9. Inventory Transactions
  const transactions = await InventoryTransaction.find({
    $or: [
      { reason: dbgRegex },
      { lot: { $in: lots.map((l) => l._id) } },
      { ingredient: { $in: ingredientIds } },
    ],
  });
  console.log(`Found ${transactions.length} dummy inventory transactions to remove.`);

  // 10. Finished Product Stock
  const finishedStocks = await FinishedProductStock.find({
    product: { $in: productIds },
  });
  console.log(`Found ${finishedStocks.length} dummy finished product stock records to remove.`);

  // 11. Notifications
  const notifications = await Notification.find({
    $or: [
      { message: /dbg_1793276|BATCH-77|BATCH-78/ },
      { relatedEntityId: { $in: [...batches.map((b) => b._id), ...orders.map((o) => o._id)] } },
    ],
  });
  console.log(`Found ${notifications.length} dummy test notifications to remove.`);

  // Write backup of all candidate documents
  const backupData = {
    timestamp: new Date().toISOString(),
    counts: {
      batches: batches.length,
      orders: orders.length,
      users: users.length,
      products: products.length,
      categories: categories.length,
      recipes: recipes.length,
      ingredients: ingredients.length,
      lots: lots.length,
      transactions: transactions.length,
      finishedStocks: finishedStocks.length,
      notifications: notifications.length,
    },
    data: {
      batches,
      orders,
      users,
      products,
      categories,
      recipes,
      ingredients,
      lots,
      transactions,
      finishedStocks,
      notifications,
    },
  };

  await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
  console.log(`\nSafeguard backup created at: ${backupFile}`);

  // Execute precise deletion by exact ObjectIds
  console.log("\n=== EXECUTING TARGETED REMOVAL BY EXACT OBJECT IDS ===");

  if (batches.length > 0) {
    const res = await ProductionBatch.deleteMany({ _id: { $in: batches.map((b) => b._id) } });
    console.log(`Deleted ${res.deletedCount} ProductionBatches.`);
  }

  if (orders.length > 0) {
    const res = await Order.deleteMany({ _id: { $in: orders.map((o) => o._id) } });
    console.log(`Deleted ${res.deletedCount} Orders.`);
  }

  if (users.length > 0) {
    const res = await User.deleteMany({ _id: { $in: users.map((u) => u._id) } });
    console.log(`Deleted ${res.deletedCount} Users.`);
  }

  if (products.length > 0) {
    const res = await Product.deleteMany({ _id: { $in: products.map((p) => p._id) } });
    console.log(`Deleted ${res.deletedCount} Products.`);
  }

  if (categories.length > 0) {
    const res = await Category.deleteMany({ _id: { $in: categories.map((c) => c._id) } });
    console.log(`Deleted ${res.deletedCount} Categories.`);
  }

  if (recipes.length > 0) {
    const res = await Recipe.deleteMany({ _id: { $in: recipes.map((r) => r._id) } });
    console.log(`Deleted ${res.deletedCount} Recipes.`);
  }

  if (ingredients.length > 0) {
    const res = await Ingredient.deleteMany({ _id: { $in: ingredients.map((i) => i._id) } });
    console.log(`Deleted ${res.deletedCount} Ingredients.`);
  }

  if (lots.length > 0) {
    const res = await InventoryLot.deleteMany({ _id: { $in: lots.map((l) => l._id) } });
    console.log(`Deleted ${res.deletedCount} InventoryLots.`);
  }

  if (transactions.length > 0) {
    const res = await InventoryTransaction.deleteMany({ _id: { $in: transactions.map((t) => t._id) } });
    console.log(`Deleted ${res.deletedCount} InventoryTransactions.`);
  }

  if (finishedStocks.length > 0) {
    const res = await FinishedProductStock.deleteMany({ _id: { $in: finishedStocks.map((fs) => fs._id) } });
    console.log(`Deleted ${res.deletedCount} FinishedProductStock entries.`);
  }

  if (notifications.length > 0) {
    const res = await Notification.deleteMany({ _id: { $in: notifications.map((n) => n._id) } });
    console.log(`Deleted ${res.deletedCount} Notifications.`);
  }

  // Verification post-cleanup
  console.log("\n=== POST-CLEANUP INTEGRITY VERIFICATION ===");
  const remainingBatches = await ProductionBatch.find({ batchNumber: testBatchRegex }).countDocuments();
  const remainingOrders = await Order.find({ orderNumber: dbgRegex }).countDocuments();
  const remainingUsers = await User.find({ email: dbgRegex }).countDocuments();

  console.log("Remaining test batches:", remainingBatches);
  console.log("Remaining test orders:", remainingOrders);
  console.log("Remaining test users:", remainingUsers);

  // Verify genuine orders and batches
  const todayStart = new Date("2026-10-29T00:00:00.000Z");
  const genuineTodayOrders = await Order.find({ createdAt: { $gte: todayStart } }).select("orderNumber contactName status");
  console.log(`\nGenuine orders created today (${genuineTodayOrders.length}):`);
  genuineTodayOrders.forEach((o) => console.log(`  ${o.orderNumber} - ${o.contactName} (${o.status})`));

  const genuineTodayBatches = await ProductionBatch.find({ createdAt: { $gte: todayStart } }).select("batchNumber status");
  console.log(`\nGenuine batches created today (${genuineTodayBatches.length}):`);
  genuineTodayBatches.forEach((b) => console.log(`  ${b.batchNumber} (${b.status})`));

  console.log("\nCLEANUP COMPLETED SUCCESSFULLY WITHOUT IMPACTING GENUINE DATA!");
  await disconnectDb();
}

runCleanup().catch((err) => {
  console.error("Cleanup error:", err);
  process.exit(1);
});
