import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart_bakery_db";
const DB_NAME = process.env.MONGO_DB_NAME || "smart_bakery_db";

// Explicit audited list of the 18 confirmed dummy order IDs
const CONFIRMED_DUMMY_ORDER_IDS = [
  "6ae2fa9da0a8fc47a4ced3cb",
  "6ae2fa9da0a8fc47a4ced3ce",
  "6ae2fa9da0a8fc47a4ced3d1",
  "6ae2fb0dc46f7d1461fa3251",
  "6ae2fb0dc46f7d1461fa3255",
  "6ae2fb0dc46f7d1461fa3259",
  "6ae2fb4e0485bd8bb500fbf8",
  "6ae2fb4e0485bd8bb500fbfc",
  "6ae2fb4e0485bd8bb500fc00",
  "6ae2fb9bbbfce79d5d0cd2f8",
  "6ae2fb9cbbfce79d5d0cd2fc",
  "6ae2fb9cbbfce79d5d0cd2ff",
  "6ae2fbe5bf4efa6b530fd2bf",
  "6ae2fbe5bf4efa6b530fd2c3",
  "6ae2fbe5bf4efa6b530fd2c6",
  "6ae2fca8cd63513691727671",
  "6ae2fca8cd63513691727675",
  "6ae2fca8cd63513691727678",
].map(id => new mongoose.Types.ObjectId(id));

async function executeCleanup() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log(`Connected to database for cleanup: ${mongoose.connection.name}`);

  if (mongoose.connection.name !== "smart_bakery_db") {
    throw new Error(`Safety stop: Expected smart_bakery_db, got ${mongoose.connection.name}`);
  }

  const Order = mongoose.connection.collection("orders");
  const ProductionBatch = mongoose.connection.collection("productionbatches");
  const IngredientRequisition = mongoose.connection.collection("ingredientrequisitions");
  const Product = mongoose.connection.collection("products");
  const Recipe = mongoose.connection.collection("recipes");
  const InventoryLot = mongoose.connection.collection("inventorylots");
  const Ingredient = mongoose.connection.collection("ingredients");
  const User = mongoose.connection.collection("users");
  const Notification = mongoose.connection.collection("notifications");

  // Step 1: Verify all 18 dummy orders exist before deletion
  const existingDummyOrders = await Order.find({ _id: { $in: CONFIRMED_DUMMY_ORDER_IDS } }).toArray();
  console.log(`Verified ${existingDummyOrders.length} of 18 dummy orders exist.`);
  if (existingDummyOrders.length !== 18) {
    throw new Error(`Expected 18 dummy orders, found ${existingDummyOrders.length}`);
  }

  // Step 2: Delete ONLY the 18 confirmed dummy orders
  const deleteOrdersResult = await Order.deleteMany({ _id: { $in: CONFIRMED_DUMMY_ORDER_IDS } });
  console.log(`✓ Deleted ${deleteOrdersResult.deletedCount} confirmed dummy orders.`);

  // Step 3: Delete associated test batches
  const deleteBatchesResult = await ProductionBatch.deleteMany({
    $or: [
      { batchNumber: { $regex: /^BATCH-UI-ui-/ } },
      { relatedOrders: { $in: CONFIRMED_DUMMY_ORDER_IDS } }
    ]
  });
  console.log(`✓ Deleted ${deleteBatchesResult.deletedCount} associated test production batches.`);

  // Step 4: Delete associated test requisitions
  const deleteReqsResult = await IngredientRequisition.deleteMany({
    $or: [
      { requisitionNumber: { $regex: /^(REQ-UI-ui-|REQ-20261029-0005)/ } },
      { "productSnapshot.productName": { $regex: /ui-179326/ } }
    ]
  });
  console.log(`✓ Deleted ${deleteReqsResult.deletedCount} associated test ingredient requisitions.`);

  // Step 5: Delete associated test products, recipes, lots, ingredients, user
  const deleteRecipesResult = await Recipe.deleteMany({ name: { $regex: /Red Velvet Recipe ui-179326/ } });
  console.log(`✓ Deleted ${deleteRecipesResult.deletedCount} test recipes.`);

  const deleteProductsResult = await Product.deleteMany({ name: { $regex: /Red Velvet Pastry ui-179326/ } });
  console.log(`✓ Deleted ${deleteProductsResult.deletedCount} test products.`);

  const deleteLotsResult = await InventoryLot.deleteMany({ lotNumber: { $regex: /LOT-(FLOUR|SUGAR)-ui-179326/ } });
  console.log(`✓ Deleted ${deleteLotsResult.deletedCount} test inventory lots.`);

  const deleteIngredientsResult = await Ingredient.deleteMany({ slug: { $regex: /-(flour|sugar)-ui-179326/ } });
  console.log(`✓ Deleted ${deleteIngredientsResult.deletedCount} test ingredients.`);

  const deleteUserResult = await User.deleteMany({ email: { $regex: /customer-ui-179326/ } });
  console.log(`✓ Deleted ${deleteUserResult.deletedCount} test user accounts.`);

  // Step 6: Verify final counts
  const remainingOrders = await Order.countDocuments();
  console.log(`\n=== Post-Cleanup Verification ===`);
  console.log(`Total remaining orders: ${remainingOrders} (Expected: 37: 26 genuine + 11 suspected)`);

  const remainingBatches = await ProductionBatch.countDocuments();
  console.log(`Total remaining production batches: ${remainingBatches}`);

  const remainingRequisitions = await IngredientRequisition.countDocuments();
  console.log(`Total remaining ingredient requisitions: ${remainingRequisitions}`);

  await mongoose.disconnect();
}

executeCleanup().catch(err => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
