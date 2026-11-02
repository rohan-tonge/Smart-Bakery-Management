import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart_bakery_db";
const DB_NAME = process.env.MONGO_DB_NAME || "smart_bakery_db";

async function checkIntegrity() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log(`Checking integrity on ${mongoose.connection.name}...\n`);

  const Order = mongoose.connection.collection("orders");
  const ProductionBatch = mongoose.connection.collection("productionbatches");
  const IngredientRequisition = mongoose.connection.collection("ingredientrequisitions");
  const Product = mongoose.connection.collection("products");
  const Recipe = mongoose.connection.collection("recipes");
  const User = mongoose.connection.collection("users");

  const orders = await Order.find({}).toArray();
  console.log(`Total Orders: ${orders.length}`);

  let missingProducts = 0;
  let missingCustomers = 0;
  for (const o of orders) {
    if (o.customer) {
      const cust = await User.findOne({ _id: o.customer });
      if (!cust) missingCustomers++;
    }
    for (const item of o.items || []) {
      if (item.productId) {
        const prod = await Product.findOne({ _id: item.productId });
        if (!prod) missingProducts++;
      }
    }
  }
  console.log(`Orders integrity: ${missingProducts} missing product refs, ${missingCustomers} missing customer refs`);

  const batches = await ProductionBatch.find({}).toArray();
  console.log(`\nTotal Production Batches: ${batches.length}`);
  let missingBatchOrders = 0;
  for (const b of batches) {
    for (const ro of b.relatedOrders || []) {
      const ord = await Order.findOne({ _id: ro });
      if (!ord) missingBatchOrders++;
    }
  }
  console.log(`Batches integrity: ${missingBatchOrders} missing order refs`);

  const reqs = await IngredientRequisition.find({}).toArray();
  console.log(`\nTotal Ingredient Requisitions: ${reqs.length}`);
  let missingReqBatches = 0;
  for (const r of reqs) {
    if (r.batch) {
      const b = await ProductionBatch.findOne({ _id: r.batch });
      if (!b) {
        console.log(`  Orphaned requisition: ${r.requisitionNumber} (Batch ID: ${r.batch})`);
        missingReqBatches++;
      }
    }
  }
  console.log(`Requisitions integrity: ${missingReqBatches} missing batch refs`);

  const recipes = await Recipe.find({}).toArray();
  console.log(`\nTotal Recipes: ${recipes.length}`);
  let missingRecipeProducts = 0;
  for (const r of recipes) {
    if (r.product) {
      const p = await Product.findOne({ _id: r.product });
      if (!p) {
        console.log(`  Orphaned recipe: ${r.name} (Product ID: ${r.product})`);
        missingRecipeProducts++;
      }
    }
  }
  console.log(`Recipes integrity: ${missingRecipeProducts} missing product refs`);

  await mongoose.disconnect();
}

checkIntegrity().catch(console.error);
