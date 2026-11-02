import mongoose from "mongoose";
import { connectToDb, disconnectDb } from "./src/config/db.js";

function isAntigravityTestMarker(str) {
  if (!str || typeof str !== "string") return false;
  return /17[0-9]{11}|ui-|test|planned|phase[0-9]|dummy|p10|concurrency|workload|analytics|labour|qcremoval|baker kabir|baker ananya/i.test(str);
}

export async function runCleanup({ isDryRun = true } = {}) {
  await connectToDb();
  const db = mongoose.connection.db;

  console.log("================================================================================");
  console.log(`SMART BAKERY MANAGEMENT SYSTEM - DUMMY DATA CLEANUP [${isDryRun ? "DRY-RUN MODE" : "LIVE EXECUTION"}]`);
  console.log("================================================================================\n");

  // 1. Identify Dummy Users
  const allUsers = await db.collection("users").find({}).sort({ createdAt: 1 }).toArray();
  const dummyUsers = allUsers.filter(u => {
    const isTestEmail = /@(test\.com|planned-test\.com|workload-test\.com|concurrency-test\.com|catalog-test\.com|phase[0-9]+-test\.com|inr-test\.com|orders-test\.com|payments-test\.com|labour-test\.com|bakery-test\.com|qcremoval-test\.com|recipe-test\.com|req-test\.com|analytics-test\.com)$/i.test(u.email)
      || isAntigravityTestMarker(u.email);
    const isTestName = isAntigravityTestMarker(u.name);
    return isTestEmail || isTestName;
  });
  const genuineUsers = allUsers.filter(u => !dummyUsers.some(d => d._id.equals(u._id)));
  const dummyUserIds = dummyUsers.map(u => u._id);

  // 2. Identify Dummy Categories
  const allCategories = await db.collection("categories").find({}).toArray();
  const dummyCategories = allCategories.filter(c => isAntigravityTestMarker(c.slug) || isAntigravityTestMarker(c.name));
  const genuineCategories = allCategories.filter(c => !dummyCategories.some(d => d._id.equals(c._id)));
  const dummyCategoryIds = dummyCategories.map(c => c._id);

  // 3. Identify Dummy Products
  const allProducts = await db.collection("products").find({}).toArray();
  const dummyProducts = allProducts.filter(p => isAntigravityTestMarker(p.slug) || isAntigravityTestMarker(p.name));
  const genuineProducts = allProducts.filter(p => !dummyProducts.some(d => d._id.equals(p._id)));
  const dummyProductIds = dummyProducts.map(p => p._id);
  const dummyProductIdStrings = new Set(dummyProductIds.map(id => id.toString()));

  // 4. Identify Dummy Ingredients
  const allIngredients = await db.collection("ingredients").find({}).toArray();
  const dummyIngredients = allIngredients.filter(i => isAntigravityTestMarker(i.slug) || isAntigravityTestMarker(i.name));
  const genuineIngredients = allIngredients.filter(i => !dummyIngredients.some(d => d._id.equals(i._id)));
  const dummyIngredientIds = dummyIngredients.map(i => i._id);
  const dummyIngredientIdStrings = new Set(dummyIngredientIds.map(id => id.toString()));

  // 5. Identify Dummy Recipes
  const allRecipes = await db.collection("recipes").find({}).toArray();
  const dummyRecipes = allRecipes.filter(r => {
    const isLinkedToDummyProduct = r.product && dummyProductIdStrings.has(r.product.toString());
    const isTestName = isAntigravityTestMarker(r.recipeName || r.name || "");
    return isLinkedToDummyProduct || isTestName;
  });
  const genuineRecipes = allRecipes.filter(r => !dummyRecipes.some(d => d._id.equals(r._id)));
  const dummyRecipeIds = dummyRecipes.map(r => r._id);
  const dummyRecipeIdStrings = new Set(dummyRecipeIds.map(id => id.toString()));

  // 6. Identify Dummy Batches
  const allBatches = await db.collection("productionbatches").find({}).toArray();
  const dummyBatches = allBatches.filter(b => {
    const isDummyBatchNumber = /^BATCH-(DIRECT|LIVE|T[0-9]|PLAN|WORKLOAD|HIST|TIMER)/i.test(b.batchNumber || "")
      || isAntigravityTestMarker(b.batchNumber);
    const isLinkedToDummyProduct = b.product && dummyProductIdStrings.has(b.product.toString());
    const isLinkedToDummyRecipe = b.recipe && dummyRecipeIdStrings.has(b.recipe.toString());
    const hasDummyProductSnapshot = isAntigravityTestMarker(b.productSnapshot?.productName || "") || isAntigravityTestMarker(b.productSnapshot?.variantName || "");
    return isDummyBatchNumber || isLinkedToDummyProduct || isLinkedToDummyRecipe || hasDummyProductSnapshot;
  });
  const genuineBatches = allBatches.filter(b => !dummyBatches.some(d => d._id.equals(b._id)));
  const dummyBatchIds = dummyBatches.map(b => b._id);
  const dummyBatchIdStrings = new Set(dummyBatchIds.map(id => id.toString()));

  // 7. Identify Dummy Orders
  const allOrders = await db.collection("orders").find({}).toArray();
  const dummyOrders = allOrders.filter(o => {
    const isDummyOrderNumber = /^ORD-(AVAIL|SHORT|T[0-9])/i.test(o.orderNumber || "") || isAntigravityTestMarker(o.orderNumber);
    const isTestCustomerName = isAntigravityTestMarker(o.contactName || "") || /^(BOM Check Customer|Acceptance Customer|Cancel Test Customer|Reservation Test Customer|Sunita Sharma|Rahul Mehra)/i.test(o.contactName || "");
    const isTestEmail = isAntigravityTestMarker(o.contactEmail || "");
    const hasTestItems = o.items && o.items.some(it => dummyProductIdStrings.has(it.productId?.toString()) || isAntigravityTestMarker(it.productName || ""));
    return isDummyOrderNumber || isTestCustomerName || isTestEmail || hasTestItems;
  });
  const genuineOrders = allOrders.filter(o => !dummyOrders.some(d => d._id.equals(o._id)));
  const dummyOrderIds = dummyOrders.map(o => o._id);
  const dummyOrderIdStrings = new Set(dummyOrderIds.map(id => id.toString()));

  // 8. Identify Dummy Payment Proofs
  const allPaymentProofs = await db.collection("paymentproofs").find({}).toArray();
  const dummyPaymentProofs = allPaymentProofs.filter(pp => pp.order && dummyOrderIdStrings.has(pp.order.toString()));
  const genuinePaymentProofs = allPaymentProofs.filter(pp => !dummyPaymentProofs.some(d => d._id.equals(pp._id)));
  const dummyPaymentProofIds = dummyPaymentProofs.map(pp => pp._id);

  // 9. Identify Dummy Inventory Lots
  const allLots = await db.collection("inventorylots").find({}).toArray();
  const dummyLots = allLots.filter(l => (l.ingredient && dummyIngredientIdStrings.has(l.ingredient.toString())) || isAntigravityTestMarker(l.lotNumber || ""));
  const genuineLots = allLots.filter(l => !dummyLots.some(d => d._id.equals(l._id)));
  const dummyLotIds = dummyLots.map(l => l._id);
  const dummyLotIdStrings = new Set(dummyLotIds.map(id => id.toString()));

  // 10. Identify Dummy Inventory Transactions
  const allTx = await db.collection("inventorytransactions").find({}).toArray();
  const dummyTx = allTx.filter(t => {
    const isDummyIngredient = t.ingredient && dummyIngredientIdStrings.has(t.ingredient.toString());
    const isDummyBatch = t.referenceId && dummyBatchIdStrings.has(t.referenceId.toString());
    const isDummyLot = t.lot && dummyLotIdStrings.has(t.lot.toString());
    const isDummyReason = isAntigravityTestMarker(t.reason || "") || isAntigravityTestMarker(t.notes || "");
    return isDummyIngredient || isDummyBatch || isDummyLot || isDummyReason;
  });
  const genuineTx = allTx.filter(t => !dummyTx.some(d => d._id.equals(t._id)));
  const dummyTxIds = dummyTx.map(t => t._id);

  // 11. Identify Dummy Finished Product Stocks
  const allFps = await db.collection("finishedproductstocks").find({}).toArray();
  const dummyFps = allFps.filter(fps => fps.product && dummyProductIdStrings.has(fps.product.toString()));
  const genuineFps = allFps.filter(fps => !dummyFps.some(d => d._id.equals(fps._id)));
  const dummyFpsIds = dummyFps.map(fps => fps._id);

  // 12. Identify Dummy Notifications
  const allNotifications = await db.collection("notifications").find({}).toArray();
  const dummyUserIdStrings = new Set(dummyUserIds.map(id => id.toString()));
  const dummyNotifications = allNotifications.filter(n => {
    const isDummyUser = n.recipient && dummyUserIdStrings.has(n.recipient.toString());
    const isDummyBatch = n.data?.batchId && dummyBatchIdStrings.has(n.data.batchId.toString());
    const isDummyOrder = n.data?.orderId && dummyOrderIdStrings.has(n.data.orderId.toString());
    const isTestMsg = isAntigravityTestMarker(n.message || "") || isAntigravityTestMarker(n.title || "");
    return isDummyUser || isDummyBatch || isDummyOrder || isTestMsg;
  });
  const genuineNotifications = allNotifications.filter(n => !dummyNotifications.some(d => d._id.equals(n._id)));
  const dummyNotificationIds = dummyNotifications.map(n => n._id);

  // SUMMARY PLAN
  const cleanupPlan = [
    { name: "users", total: allUsers.length, toDelete: dummyUsers.length, toPreserve: genuineUsers.length, ids: dummyUserIds },
    { name: "categories", total: allCategories.length, toDelete: dummyCategories.length, toPreserve: genuineCategories.length, ids: dummyCategoryIds },
    { name: "products", total: allProducts.length, toDelete: dummyProducts.length, toPreserve: genuineProducts.length, ids: dummyProductIds },
    { name: "ingredients", total: allIngredients.length, toDelete: dummyIngredients.length, toPreserve: genuineIngredients.length, ids: dummyIngredientIds },
    { name: "recipes", total: allRecipes.length, toDelete: dummyRecipes.length, toPreserve: genuineRecipes.length, ids: dummyRecipeIds },
    { name: "productionbatches", total: allBatches.length, toDelete: dummyBatches.length, toPreserve: genuineBatches.length, ids: dummyBatchIds },
    { name: "orders", total: allOrders.length, toDelete: dummyOrders.length, toPreserve: genuineOrders.length, ids: dummyOrderIds },
    { name: "paymentproofs", total: allPaymentProofs.length, toDelete: dummyPaymentProofs.length, toPreserve: genuinePaymentProofs.length, ids: dummyPaymentProofIds },
    { name: "inventorylots", total: allLots.length, toDelete: dummyLots.length, toPreserve: genuineLots.length, ids: dummyLotIds },
    { name: "inventorytransactions", total: allTx.length, toDelete: dummyTx.length, toPreserve: genuineTx.length, ids: dummyTxIds },
    { name: "finishedproductstocks", total: allFps.length, toDelete: dummyFps.length, toPreserve: genuineFps.length, ids: dummyFpsIds },
    { name: "notifications", total: allNotifications.length, toDelete: dummyNotifications.length, toPreserve: genuineNotifications.length, ids: dummyNotificationIds },
  ];

  console.log("AFFECTED COLLECTIONS SUMMARY:");
  console.log("--------------------------------------------------------------------------------");
  console.log(
    "Collection".padEnd(25) +
    "Total Docs".padStart(12) +
    "To Delete".padStart(12) +
    "To Preserve".padStart(14)
  );
  console.log("--------------------------------------------------------------------------------");

  let totalDocsToDelete = 0;
  for (const item of cleanupPlan) {
    totalDocsToDelete += item.toDelete;
    console.log(
      item.name.padEnd(25) +
      item.total.toString().padStart(12) +
      item.toDelete.toString().padStart(12) +
      item.toPreserve.toString().padStart(14)
    );
  }
  console.log("--------------------------------------------------------------------------------");
  console.log(`TOTAL RECORDS TO CLEAN UP: ${totalDocsToDelete}\n`);

  if (isDryRun) {
    console.log("[DRY-RUN] No database modifications were made. All records remain untouched.");
    console.log("To execute deletion after user approval, run: node --env-file=.env cleanup-dummy-data.mjs --execute");
    await disconnectDb();
    return { cleanupPlan, totalDocsToDelete };
  }

  // LIVE EXECUTION (Only when isDryRun === false)
  console.log("[EXECUTION] Commencing targeted deletion of audited dummy records...");

  let totalDeletedActual = 0;
  for (const item of cleanupPlan) {
    if (item.ids.length > 0) {
      // RULE: Never use unrestricted deleteMany({}). Always use explicit _id: { $in: item.ids }
      const res = await db.collection(item.name).deleteMany({ _id: { $in: item.ids } });
      if (res.deletedCount !== item.toDelete) {
        throw new Error(`ABORT / DISCREPANCY: Expected to delete ${item.toDelete} in '${item.name}', but deleted ${res.deletedCount}!`);
      }
      totalDeletedActual += res.deletedCount;
      console.log(`✔ [${item.name}] Successfully deleted exactly ${res.deletedCount} dummy records.`);
    } else {
      console.log(`- [${item.name}] No records to delete.`);
    }
  }

  if (totalDeletedActual !== totalDocsToDelete) {
    throw new Error(`ABORT: Expected total deletions of ${totalDocsToDelete}, but deleted ${totalDeletedActual}!`);
  }

  console.log(`\n✔ All ${totalDeletedActual} reviewed candidate documents deleted successfully.\n`);

  // POST-CLEANUP INTEGRITY & HEALTH VERIFICATION
  console.log("================================================================================");
  console.log("POST-CLEANUP DATABASE & APPLICATION INTEGRITY VERIFICATION");
  console.log("================================================================================\n");

  const expectedPostCleanupCounts = {
    users: 4,
    categories: 5,
    products: 9,
    ingredients: 27,
    recipes: 9,
    productionbatches: 19,
    orders: 31,
    paymentproofs: 12,
    inventorylots: 28,
    inventorytransactions: 169,
    finishedproductstocks: 7,
    notifications: 128,
    carts: 26,
    deliveryslotreservations: 11,
    ingredientrequisitions: 18,
    vendors: 1,
    purchases: 4,
    settings: 2,
    ordercounters: 1,
    productionbatchcounters: 7,
    requisitioncounters: 8,
  };

  let totalProtectedActual = 0;
  for (const [colName, expCount] of Object.entries(expectedPostCleanupCounts)) {
    const actual = await db.collection(colName).countDocuments();
    if (actual !== expCount) {
      throw new Error(`POST-CLEANUP INTEGRITY FAILURE: Collection '${colName}' expected ${expCount} records, found ${actual}!`);
    }
    totalProtectedActual += actual;
    console.log(`✔ Collection '${colName.padEnd(25)}' verified: ${actual} documents remaining.`);
  }

  console.log(`\n✔ Exactly ${totalProtectedActual} protected records verified across all 21 collections.`);

  // Check critical staff accounts
  const admin = await db.collection("users").findOne({ email: "admin@gmail.com" });
  const staff1 = await db.collection("users").findOne({ email: "production@staff.com" });
  const staff2 = await db.collection("users").findOne({ email: "production2@staff.com" });
  const staff3 = await db.collection("users").findOne({ email: "baker@gmail.com" });
  if (!admin || !staff1 || !staff2 || !staff3) {
    throw new Error("POST-CLEANUP INTEGRITY FAILURE: One of the 4 genuine staff/owner accounts is missing!");
  }
  console.log(`✔ All 4 genuine staff/owner accounts intact: Admin, product_staff, production2, Baker_1.`);

  // Check critical catalog products
  const remainingProds = await db.collection("products").find({}).toArray();
  console.log(`✔ All 9 genuine catalog products intact: ${remainingProds.map(p => p.name).join(", ")}`);

  // Check genuine batches and orders
  const remainingBatches = await db.collection("productionbatches").find({}).toArray();
  console.log(`✔ All 19 genuine operational batches intact: ${remainingBatches[0].batchNumber} to ${remainingBatches[remainingBatches.length - 1].batchNumber}.`);
  const remainingOrders = await db.collection("orders").find({}).toArray();
  console.log(`✔ All 31 genuine customer orders intact: ${remainingOrders[0].orderNumber} to ${remainingOrders[remainingOrders.length - 1].orderNumber}.`);

  // Verify post-cleanup referential integrity
  let postBrokenRefs = 0;
  const remainingProdIds = new Set(remainingProds.map(p => p._id.toString()));
  for (const b of remainingBatches) {
    if (b.product && !remainingProdIds.has(b.product.toString())) postBrokenRefs++;
  }
  for (const o of remainingOrders) {
    for (const it of (o.items || [])) {
      if (it.productId && !remainingProdIds.has(it.productId.toString())) postBrokenRefs++;
    }
  }

  if (postBrokenRefs > 0) {
    throw new Error(`POST-CLEANUP INTEGRITY FAILURE: Found ${postBrokenRefs} broken references!`);
  }
  console.log(`✔ Post-cleanup referential integrity verified: 0 broken references.`);

  console.log("\n================================================================================");
  console.log("✔ LIVE CLEANUP & POST-CLEANUP INTEGRITY VERIFICATION COMPLETED SUCCESSFULLY.");
  console.log("================================================================================");
  await disconnectDb();
}

const isExecute = process.argv.includes("--execute");
runCleanup({ isDryRun: !isExecute }).catch(console.error);
