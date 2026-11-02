import mongoose from "mongoose";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart_bakery_db";
const DB_NAME = process.env.MONGO_DB_NAME || "smart_bakery_db";

async function auditAssociated() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });

  const Order = mongoose.connection.collection("orders");
  const Payment = mongoose.connection.collection("payments");
  const PaymentProof = mongoose.connection.collection("paymentproofs");
  const ProductionBatch = mongoose.connection.collection("productionbatches");
  const IngredientRequisition = mongoose.connection.collection("ingredientrequisitions");
  const Notification = mongoose.connection.collection("notifications");
  const Product = mongoose.connection.collection("products");
  const Recipe = mongoose.connection.collection("recipes");
  const InventoryLot = mongoose.connection.collection("inventorylots");
  const Ingredient = mongoose.connection.collection("ingredients");
  const User = mongoose.connection.collection("users");

  // The 18 confirmed dummy orders
  const dummyOrders = await Order.find({
    orderNumber: { $regex: /^ORD-(ACTIVE|CANC|DELIV)-ui-/ }
  }).toArray();

  console.log(`Found ${dummyOrders.length} confirmed dummy orders.\n`);
  const dummyOrderIds = dummyOrders.map(o => o._id);
  const dummyOrderIdStrs = dummyOrderIds.map(id => String(id));

  // Find linked payments & proofs
  const linkedPayments = await Payment.find({ order: { $in: dummyOrderIds } }).toArray();
  const linkedProofs = await PaymentProof.find({ orderId: { $in: dummyOrderIds } }).toArray();

  // Find linked batches
  const linkedBatches = await ProductionBatch.find({
    $or: [
      { relatedOrders: { $in: dummyOrderIds } },
      { batchNumber: { $regex: /^BATCH-UI-ui-/ } }
    ]
  }).toArray();
  const linkedBatchIds = linkedBatches.map(b => b._id);

  // Find linked requisitions
  const linkedRequisitions = await IngredientRequisition.find({
    $or: [
      { batch: { $in: linkedBatchIds } },
      { requisitionNumber: { $regex: /^REQ-UI-/ } }
    ]
  }).toArray();

  // Find linked notifications
  const linkedNotifications = await Notification.find({
    $or: [
      { "metadata.orderId": { $in: dummyOrderIdStrs } },
      { "metadata.batchId": { $in: linkedBatchIds.map(String) } }
    ]
  }).toArray();

  // Find test products
  const testProducts = await Product.find({
    name: { $regex: /ui-179326/ }
  }).toArray();
  const testProductIds = testProducts.map(p => p._id);

  // Find test recipes
  const testRecipes = await Recipe.find({
    product: { $in: testProductIds }
  }).toArray();

  // Find test ingredients
  const testIngredients = await Ingredient.find({
    name: { $regex: /ui-179326/ }
  }).toArray();
  const testIngredientIds = testIngredients.map(i => i._id);

  // Find test inventory lots
  const testLots = await InventoryLot.find({
    lotNumber: { $regex: /ui-179326/ }
  }).toArray();

  // Find test customer
  const testCustomers = await User.find({
    email: { $regex: /customer-ui-179326/ }
  }).toArray();

  // Check if ANY genuine order references any of these test products, ingredients, or customers!
  const genuineOrders = await Order.find({
    _id: { $nin: dummyOrderIds }
  }).toArray();

  const crossReferenceCheck = {
    genuineOrdersReferencingTestProducts: 0,
    genuineOrdersReferencingTestCustomer: 0,
    genuineBatchesReferencingTestOrders: 0,
  };

  for (const go of genuineOrders) {
    if (testCustomers.some(tc => String(tc._id) === String(go.customer))) {
      crossReferenceCheck.genuineOrdersReferencingTestCustomer++;
    }
    for (const item of go.items || []) {
      if (testProductIds.some(tp => String(tp) === String(item.productId))) {
        crossReferenceCheck.genuineOrdersReferencingTestProducts++;
      }
    }
  }

  const result = {
    dummyOrdersCount: dummyOrders.length,
    dummyOrders: dummyOrders.map(o => ({
      _id: o._id,
      orderNumber: o.orderNumber,
      status: o.status,
      contactName: o.contactName,
      contactPhone: o.contactPhone,
      total: o.total,
      createdAt: o.createdAt,
    })),
    associatedRecords: {
      paymentsCount: linkedPayments.length,
      paymentProofsCount: linkedProofs.length,
      productionBatchesCount: linkedBatches.length,
      productionBatches: linkedBatches.map(b => ({ _id: b._id, batchNumber: b.batchNumber, status: b.status })),
      ingredientRequisitionsCount: linkedRequisitions.length,
      ingredientRequisitions: linkedRequisitions.map(r => ({ _id: r._id, requisitionNumber: r.requisitionNumber, status: r.status })),
      notificationsCount: linkedNotifications.length,
      testProductsCount: testProducts.length,
      testRecipesCount: testRecipes.length,
      testIngredientsCount: testIngredients.length,
      testLotsCount: testLots.length,
      testCustomersCount: testCustomers.length,
    },
    safetyAudit: crossReferenceCheck,
  };

  fs.writeFileSync("associated_audit.json", JSON.stringify(result, null, 2), "utf8");
  console.log("Associated Records Summary:");
  console.log(JSON.stringify({
    dummyOrders: result.dummyOrdersCount,
    payments: result.associatedRecords.paymentsCount,
    paymentProofs: result.associatedRecords.paymentProofsCount,
    batches: result.associatedRecords.productionBatchesCount,
    requisitions: result.associatedRecords.ingredientRequisitionsCount,
    notifications: result.associatedRecords.notificationsCount,
    testProducts: result.associatedRecords.testProductsCount,
    testRecipes: result.associatedRecords.testRecipesCount,
    testIngredients: result.associatedRecords.testIngredientsCount,
    testLots: result.associatedRecords.testLotsCount,
    testCustomers: result.associatedRecords.testCustomersCount,
    crossReferences: result.safetyAudit,
  }, null, 2));

  await mongoose.disconnect();
}

auditAssociated().catch(console.error);
