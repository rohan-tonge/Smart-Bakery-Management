import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart_bakery_db";
const DB_NAME = process.env.MONGO_DB_NAME || "smart_bakery_db";

async function cleanOrphans() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });

  const IngredientRequisition = mongoose.connection.collection("ingredientrequisitions");
  const Recipe = mongoose.connection.collection("recipes");
  const ProductionBatch = mongoose.connection.collection("productionbatches");
  const Product = mongoose.connection.collection("products");

  // Find requisitions whose batch doesn't exist in productionbatches
  const reqs = await IngredientRequisition.find({}).toArray();
  for (const r of reqs) {
    if (r.batch) {
      const b = await ProductionBatch.findOne({ _id: r.batch });
      if (!b) {
        await IngredientRequisition.deleteOne({ _id: r._id });
        console.log(`Deleted orphaned test requisition: ${r.requisitionNumber}`);
      }
    }
  }

  // Find recipes whose product doesn't exist in products
  const recipes = await Recipe.find({}).toArray();
  for (const rc of recipes) {
    if (rc.product) {
      const p = await Product.findOne({ _id: rc.product });
      if (!p) {
        await Recipe.deleteOne({ _id: rc._id });
        console.log(`Deleted orphaned test recipe: ID ${rc._id}`);
      }
    }
  }

  await mongoose.disconnect();
}

cleanOrphans().catch(console.error);
