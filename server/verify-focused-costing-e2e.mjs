import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';

// 1. Force test environment so config and database point to smart_bakery_db_test
process.env.NODE_ENV = 'test';

const { default: app } = await import('./src/app.js');
const { default: User } = await import('./src/models/user.model.js');
const { default: Product } = await import('./src/models/product.model.js');
const { default: Category } = await import('./src/models/category.model.js');
const { default: Recipe } = await import('./src/models/recipe.model.js');
const { default: InventoryLot } = await import('./src/models/inventoryLot.model.js');
const { default: Ingredient } = await import('./src/models/ingredient.model.js');
const { default: ProductionBatch } = await import('./src/models/productionBatch.model.js');
const { default: Order } = await import('./src/models/order.model.js');
const { default: Payment } = await import('./src/models/payment.model.js');
const { default: FinishedProductStock } = await import('./src/models/finishedProductStock.model.js');
const { connectToDb, disconnectDb } = await import('./src/config/db.js');
const { generateAccessToken } = await import('./src/utils/token.utils.js');
const { USER_ROLES } = await import('./src/utils/constants.js');
const { formatINR, formatPaiseINR } = await import('./src/utils/money.utils.js');

async function runFocusedVerification() {
  console.log('================================================================');
  console.log('   SMART BAKERY — FOCUSED END-TO-END LABOUR COSTING AUDIT      ');
  console.log('================================================================\n');

  // Step 8 Verification: Check smart_bakery_db BEFORE anything else
  console.log('[Step 8 Pre-Check] Inspecting real historical records in smart_bakery_db...');
  const prodConn = await mongoose.createConnection('mongodb://127.0.0.1:27017/smart_bakery_db').asPromise();
  const realBatchesBefore = await prodConn.collection('productionbatches').find({}, {
    projection: { batchNumber: 1, status: 1, 'costing.status': 1 }
  }).sort({ batchNumber: 1 }).toArray();

  assert.equal(realBatchesBefore.length, 9, 'Expected exactly 9 batches in smart_bakery_db');
  realBatchesBefore.forEach((b) => {
    assert.equal(b.status, 'COMPLETED', `Batch ${b.batchNumber} status should be COMPLETED`);
    assert.equal(b.costing?.status, 'NOT_FINALIZED', `Batch ${b.batchNumber} costing.status should be NOT_FINALIZED`);
  });
  console.log(`✓ Confirmed 9 historical batches in smart_bakery_db are UNFINALIZED & UNTOUCHED:\n  ${realBatchesBefore.map(b => b.batchNumber).join(', ')}`);
  await prodConn.close();

  // Step 1 Verification: Connect app to isolated smart_bakery_db_test
  console.log('\n[Step 1] Connecting to isolated test database...');
  await connectToDb();
  assert.equal(mongoose.connection.name, 'smart_bakery_db_test', 'App MUST connect to smart_bakery_db_test');
  console.log(`✓ Connected to isolated database: ${mongoose.connection.name}`);

  const suffix = `e2e_${Date.now()}`;
  let ownerToken;
  let staffToken;
  let ownerUser;
  let staffUser;
  let category;
  let ingredient;
  let lot;
  let product;
  let variantId;
  let recipe;
  let testBatchId;
  let testBatchNumber;
  let orderId;

  try {
    // Setup isolated test users & catalog
    console.log('\n[Setup] Seeding test entities in smart_bakery_db_test...');
    ownerUser = await User.create({
      name: `Owner Test ${suffix}`,
      email: `owner-${suffix}@labour-verify.com`,
      password: 'Password123!',
      role: 'OWNER_MANAGER',
      isActive: true,
    });
    ownerToken = generateAccessToken(ownerUser);

    staffUser = await User.create({
      name: `Baker Vikram ${suffix}`,
      email: `vikram-${suffix}@labour-verify.com`,
      password: 'Password123!',
      role: 'PRODUCTION_STAFF',
      jobDesignation: 'Master Baker',
      hourlyLabourRate: 175.00, // ₹175.00/hour
      isActive: true,
    });
    staffToken = generateAccessToken(staffUser);
    console.log(`✓ Created test staff Vikram with hourlyLabourRate = ₹${staffUser.hourlyLabourRate}/hour`);

    category = await Category.create({ name: `Bread ${suffix}`, slug: `bread-${suffix}` });
    ingredient = await Ingredient.create({
      name: `Organic Flour ${suffix}`,
      slug: `organic-flour-${suffix}`,
      category: category._id,
      unit: 'kg',
      minStockThreshold: 10,
    });

    lot = await InventoryLot.create({
      ingredient: ingredient._id,
      lotNumber: `LOT-E2E-${suffix}`,
      originalQuantity: 100,
      remainingQuantity: 100,
      unit: 'kg',
      unitCost: 42.50, // ₹42.50/kg
      purchaseDate: new Date(),
      status: 'AVAILABLE',
    });

    variantId = new mongoose.Types.ObjectId();
    product = await Product.create({
      name: `Sourdough Boule ${suffix}`,
      slug: `sourdough-boule-${suffix}`,
      category: category._id,
      variants: [
        {
          _id: variantId,
          name: 'Boule 750g',
          quantity: 1,
          unit: 'piece',
          sku: `SKU-BOULE-${suffix}`,
          price: 150.00,
          weightGrams: 750,
          inventory: 100,
          isActive: true,
        },
      ],
      price: 150.00,
      shelfLifeDays: 3,
      leadTimeHours: 12,
    });

    recipe = await Recipe.create({
      product: product._id,
      variant: variantId,
      expectedYield: 25,
      yieldUnit: 'piece',
      labourCostPerMinute: 2.5,
      powerCostPerMinute: 1.2,
      packagingCostPerUnit: 2.0,
      ingredients: [
        {
          ingredient: ingredient._id,
          quantity: 12,
          unit: 'kg',
        },
      ],
    });
    console.log(`✓ Created test product, recipe, and inventory lot (${lot.lotNumber})`);

    // =========================================================================
    // Step 6 Verification: Missing hours/rate snapshots block finalization
    // =========================================================================
    console.log('\n[Step 6] Testing incomplete batch finalization rejection...');
    const incompleteBatch = await ProductionBatch.create({
      batchNumber: `BATCH-INCOMPLETE-${suffix}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: 'Boule 750g',
        variantQuantity: 1,
        variantUnit: 'piece',
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        recipeBatchQuantity: 1,
        expectedYield: 25,
        yieldUnit: 'piece',
        labourCostPerMinute: 2.5,
        powerCostPerMinute: 1.2,
        packagingCostPerUnit: 2.0,
        ingredients: [
          {
            ingredient: ingredient._id,
            name: ingredient.name,
            quantity: 12,
            unit: 'kg',
          },
        ],
      },
      plannedQuantity: 25,
      producedQuantity: 25,
      usableQuantity: 25,
      wastageQuantity: 0,
      unit: 'piece',
      status: 'COMPLETED',
      consumptionStatus: 'CONSUMED',
      consumedIngredients: [
        {
          ingredient: ingredient._id,
          ingredientName: ingredient.name,
          lot: lot._id,
          lotNumber: lot.lotNumber,
          quantity: 12,
          unit: 'kg',
          unitCostSnapshot: 42.50,
        },
      ],
      assignedWorkers: [
        {
          worker: staffUser._id,
          task: 'Mixing & Baking',
          hourlyRateSnapshot: 175.00,
          actualHours: null, // MISSING HOURS!
        },
      ],
      costing: { status: 'NOT_FINALIZED' },
      createdBy: ownerUser._id,
    });

    const costReviewRes = await request(app)
      .get(`/api/v1/production/batches/${incompleteBatch._id}/cost`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(costReviewRes.status, 200);
    assert.ok(
      costReviewRes.body.data.cost.status === 'INCOMPLETE' || costReviewRes.body.data.cost.status === 'NOT_READY',
      `Expected status INCOMPLETE or NOT_READY, got ${costReviewRes.body.data.cost.status}`
    );
    assert.ok(
      costReviewRes.body.data.cost.incomplete.some((msg) => msg.includes('Missing actual hours for assigned worker')),
      `Expected missing actual hours message, got ${JSON.stringify(costReviewRes.body.data.cost.incomplete)}`
    );
    console.log(`✓ Cost review reports ${costReviewRes.body.data.cost.status} with clear explanation: "${costReviewRes.body.data.cost.incomplete[0]}"`);

    const prematureFinalize = await request(app)
      .post(`/api/v1/production/batches/${incompleteBatch._id}/cost/finalize`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    assert.equal(prematureFinalize.status, 409, 'Premature finalization must return HTTP 409');
    console.log(`✓ Premature finalization blocked with HTTP 409 Conflict: "${prematureFinalize.body.message}"`);

    // =========================================================================
    // Step 7 Verification: RBAC - Production staff cannot modify snapshots or costing
    // =========================================================================
    console.log('\n[Step 7] Testing RBAC protections for production staff...');
    
    // Staff attempts to update hourlyRateSnapshot via assignment endpoint
    const staffRateAttempt = await request(app)
      .patch(`/api/v1/production/batches/${incompleteBatch._id}/assignment`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ hourlyRateSnapshot: 500 });
    assert.equal(staffRateAttempt.status, 403, 'Staff modifying hourlyRateSnapshot must return 403');
    assert.ok(
      staffRateAttempt.body.message.includes('Production staff cannot modify labour rate snapshots'),
      'Expected forbidden message for staff snapshot modification'
    );
    console.log(`✓ Staff modifying hourlyRateSnapshot blocked with HTTP 403: "${staffRateAttempt.body.message}"`);

    // Staff attempts to save draft cost
    const staffDraftAttempt = await request(app)
      .patch(`/api/v1/production/batches/${incompleteBatch._id}/cost/draft`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ packagingCost: 50 });
    assert.equal(staffDraftAttempt.status, 403, 'Staff saving draft cost must return 403');

    // Staff attempts to finalize cost
    const staffFinalizeAttempt = await request(app)
      .post(`/api/v1/production/batches/${incompleteBatch._id}/cost/finalize`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});
    assert.equal(staffFinalizeAttempt.status, 403, 'Staff finalizing cost must return 403');

    // Staff attempts to view cost
    const staffViewCostAttempt = await request(app)
      .get(`/api/v1/production/batches/${incompleteBatch._id}/cost`)
      .set('Authorization', `Bearer ${staffToken}`);
    assert.equal(staffViewCostAttempt.status, 403, 'Staff viewing batch cost must return 403');

    // Staff attempts to update worker profile rate
    const staffWorkerUpdate = await request(app)
      .patch(`/api/v1/workers/${staffUser._id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ hourlyLabourRate: 999 });
    assert.equal(staffWorkerUpdate.status, 403, 'Staff updating profile labour rate must return 403');
    console.log('✓ All 5 owner-only costing & rate endpoints blocked for production staff with HTTP 403 Forbidden');

    // =========================================================================
    // Step 2 Verification: Create test batch, snapshot rate, record hours
    // =========================================================================
    console.log('\n[Step 2] Creating test production batch & verifying snapshot persistence...');
    const createBatchRes = await request(app)
      .post('/api/v1/production/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        product: String(product._id),
        productVariant: String(variantId),
        plannedQuantity: 25,
        assignedWorkers: [{ worker: String(staffUser._id), task: 'Dough Mixing & Proofing' }],
      });
    assert.equal(createBatchRes.status, 201, 'Batch creation must succeed');
    testBatchId = createBatchRes.body.data.batch._id;
    testBatchNumber = createBatchRes.body.data.batch.batchNumber;
    console.log(`✓ Test batch created: ID = ${testBatchId}, Number = ${testBatchNumber}`);

    let batchDoc = await ProductionBatch.findById(testBatchId);
    assert.equal(batchDoc.assignedWorkers.length, 1);
    assert.equal(batchDoc.assignedWorkers[0].hourlyRateSnapshot, 175.00, 'Batch must capture staff rate snapshot 175.00');
    console.log(`✓ Initial rate snapshot captured: ₹${batchDoc.assignedWorkers[0].hourlyRateSnapshot}/hr`);

    // Change worker profile rate in User collection
    console.log('  Updating Vikram profile rate from ₹175 to ₹250...');
    const updateWorkerRes = await request(app)
      .patch(`/api/v1/workers/${staffUser._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ hourlyLabourRate: 250.00 });
    assert.equal(updateWorkerRes.status, 200);

    // Update batch notes/assignments
    console.log('  Updating batch details via API...');
    const updateBatchRes = await request(app)
      .patch(`/api/v1/production/batches/${testBatchId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        productionNotes: 'Extended fermentation 18h',
        assignedWorkers: [{ worker: String(staffUser._id), task: 'Dough Mixing, Proofing & Baking' }],
      });
    assert.equal(updateBatchRes.status, 200);

    // Verify snapshot was NOT overwritten
    batchDoc = await ProductionBatch.findById(testBatchId);
    assert.equal(
      batchDoc.assignedWorkers[0].hourlyRateSnapshot,
      175.00,
      'Batch rate snapshot must remain 175.00 despite profile update to 250.00'
    );
    console.log(`✓ Rate snapshot preserved: ₹${batchDoc.assignedWorkers[0].hourlyRateSnapshot}/hr (Profile rate is ₹250.00)`);

    // Record actual hours (3.5 hours)
    console.log('  Recording 3.5 actual hours worked...');
    const recordHoursRes = await request(app)
      .patch(`/api/v1/production/batches/${testBatchId}/assignment`)
      .set('Authorization', `Bearer ${staffToken}`) // Staff can record their own hours
      .send({ actualHours: 3.5 });
    assert.equal(recordHoursRes.status, 200);

    batchDoc = await ProductionBatch.findById(testBatchId);
    assert.equal(batchDoc.assignedWorkers[0].actualHours, 3.5);
    console.log(`✓ Actual hours recorded: ${batchDoc.assignedWorkers[0].actualHours} hrs`);

    // Transition batch to COMPLETED with consumed ingredients
    console.log('  Consuming ingredients and completing batch...');
    batchDoc.status = 'COMPLETED';
    batchDoc.consumptionStatus = 'CONSUMED';
    batchDoc.producedQuantity = 25;
    batchDoc.usableQuantity = 25;
    batchDoc.wastageQuantity = 0;
    batchDoc.consumedIngredients = [
      {
        ingredient: ingredient._id,
        ingredientName: ingredient.name,
        lot: lot._id,
        lotNumber: lot.lotNumber,
        quantity: 12,
        unit: 'kg',
        unitCostSnapshot: 42.50,
      },
    ];
    await batchDoc.save();
    console.log(`✓ Batch status set to COMPLETED with 12 kg @ ₹42.50/kg consumed`);

    // =========================================================================
    // Step 3 & 4 Verification: Formula, Draft Saving, Refresh, Rounding, INR
    // =========================================================================
    console.log('\n[Step 3 & 4] Verifying labour formula, draft saving, refresh, paise rounding & INR...');
    
    // Expected Calculations:
    // Ingredient Cost: 12 kg * 42.50/kg = 510.00 rupees = 51000 paise
    // Labour Cost: 3.5 hours * 175.00/hour = 612.50 rupees = 61250 paise
    // Draft Packaging Cost: 65.50 rupees = 6550 paise
    // Draft Other Expenses: 72.00 rupees = 7200 paise
    // Total Batch Cost: 51000 + 61250 + 6550 + 7200 = 126000 paise = 1260.00 rupees
    // Usable Yield: 25 loaves
    // Cost per Usable Item: 126000 / 25 = 5040 paise = 50.40 rupees
    
    // Save draft packaging and expenses
    const saveDraftRes = await request(app)
      .patch(`/api/v1/production/batches/${testBatchId}/cost/draft`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        packagingCost: 65.50,
        expenses: [{ description: 'Baking Fuel & Gas', amount: 72.00, notes: 'Deck oven gas consumption' }],
      });
    assert.equal(saveDraftRes.status, 200, 'Draft saving must succeed');
    console.log('✓ Draft packaging and expenses saved via PATCH /cost/draft');

    // Simulate page refresh / fresh DB query
    console.log('  Simulating page refresh: querying MongoDB smart_bakery_db_test directly...');
    const refreshedBatch = await ProductionBatch.findById(testBatchId);
    assert.equal(refreshedBatch.costing.status, 'NOT_FINALIZED', 'Batch must remain NOT_FINALIZED');
    assert.equal(refreshedBatch.costing.packagingCostPaise, 6550, 'Draft packaging paise must persist as 6550');
    assert.equal(refreshedBatch.costing.expenses.length, 1);
    assert.equal(refreshedBatch.costing.expenses[0].amountPaise, 7200, 'Draft expense paise must persist as 7200');
    console.log('✓ Draft values survived refresh in smart_bakery_db_test (status: NOT_FINALIZED, NOT locked)');

    // Verify GET /cost preview calculations & INR formatting
    const reviewRes = await request(app)
      .get(`/api/v1/production/batches/${testBatchId}/cost`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(reviewRes.status, 200);
    const cost = reviewRes.body.data.cost;

    console.log('\n--- Actual Persisted & Calculated Values ---');
    console.log(`Ingredient Cost:  ₹${cost.ingredientCost}`);
    console.log(`Labour Cost:      ₹${cost.labourCost} [Formula: 3.5 hrs * ₹175.00/hr = ₹612.50]`);
    console.log(`Packaging Cost:   ₹${cost.packagingCost}`);
    console.log(`Other Expenses:   ₹${cost.otherExpense}`);
    console.log(`Total Cost:       ₹${cost.totalCost}`);
    console.log(`Usable Quantity:  ${cost.usableQuantity} units`);
    console.log(`Unit Cost:        ₹${cost.costPerUsableItem}`);
    console.log(`Costing Status:   ${cost.status}`);
    console.log('--------------------------------------------\n');

    assert.equal(cost.ingredientCost, 510.00);
    assert.equal(cost.labourCost, 612.50);
    assert.equal(cost.packagingCost, 65.50);
    assert.equal(cost.otherExpense, 72.00);
    assert.equal(cost.totalCost, 1260.00);
    assert.equal(cost.costPerUsableItem, 50.40);
    assert.equal(cost.status, 'READY_TO_FINALIZE');

    // Check INR formatting
    const formattedTotal = formatINR(cost.totalCost);
    const formattedUnit = formatINR(cost.costPerUsableItem);
    const formattedPaise = formatPaiseINR(126000);
    assert.ok(formattedTotal.includes('₹'), 'Total cost format must include ₹');
    assert.ok(formattedUnit.includes('₹'), 'Unit cost format must include ₹');
    assert.equal(formattedTotal, formattedPaise, 'Rupee and Paise formatters must produce identical output');
    console.log(`✓ Verified exact paise math & INR formatting: Total = ${formattedTotal}, Unit = ${formattedUnit}`);

    // =========================================================================
    // Step 5 Verification: Finalize isolated test batch, verify locks & analytics
    // =========================================================================
    console.log('\n[Step 5] Finalizing isolated test batch...');
    const finalizeRes = await request(app)
      .post(`/api/v1/production/batches/${testBatchId}/cost/finalize`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        packagingCost: 65.50,
        expenses: [{ description: 'Baking Fuel & Gas', amount: 72.00, notes: 'Deck oven gas consumption' }],
      });
    assert.equal(finalizeRes.status, 200, 'Finalization must succeed');
    assert.equal(finalizeRes.body.data.cost.status, 'FINALIZED');
    console.log(`✓ Batch ${testBatchNumber} finalized successfully (API status: FINALIZED)`);

    // Verify persisted database document fields in smart_bakery_db_test
    const finalizedDoc = await ProductionBatch.findById(testBatchId);
    assert.equal(finalizedDoc.costing.status, 'FINALIZED');
    assert.equal(finalizedDoc.costing.ingredientCostPaise, 51000);
    assert.equal(finalizedDoc.costing.labourCostPaise, 61250);
    assert.equal(finalizedDoc.costing.packagingCostPaise, 6550);
    assert.equal(finalizedDoc.costing.otherExpensePaise, 7200);
    assert.equal(finalizedDoc.costing.totalCostPaise, 126000);
    assert.equal(finalizedDoc.costing.costPerUsableItemPaise, 5040);
    console.log(`✓ Verified persisted database fields in smart_bakery_db_test:
      status:                  ${finalizedDoc.costing.status}
      ingredientCostPaise:     ${finalizedDoc.costing.ingredientCostPaise} (₹510.00)
      labourCostPaise:         ${finalizedDoc.costing.labourCostPaise} (₹612.50)
      packagingCostPaise:      ${finalizedDoc.costing.packagingCostPaise} (₹65.50)
      otherExpensePaise:       ${finalizedDoc.costing.otherExpensePaise} (₹72.00)
      totalCostPaise:          ${finalizedDoc.costing.totalCostPaise} (₹1,260.00)
      costPerUsableItemPaise:  ${finalizedDoc.costing.costPerUsableItemPaise} (₹50.40/unit)`);

    // Verify Lock against assignment modifications
    console.log('  Testing post-finalization lock on worker assignment modifications...');
    const postFinalizeAssignment = await request(app)
      .patch(`/api/v1/production/batches/${testBatchId}/assignment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ actualHours: 5.0 });
    assert.equal(postFinalizeAssignment.status, 409, 'Modifying finalized batch must return HTTP 409');
    assert.ok(
      postFinalizeAssignment.body.message.includes('already finalized'),
      'Expected conflict message for finalized batch assignment update'
    );
    console.log(`✓ Lock verified: assignment modification rejected with HTTP 409 ("${postFinalizeAssignment.body.message}")`);

    // Verify Duplicate-submission Protection
    console.log('  Testing duplicate-submission protection on finalize endpoint...');
    const duplicateFinalize = await request(app)
      .post(`/api/v1/production/batches/${testBatchId}/cost/finalize`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ packagingCost: 65.50 });
    assert.equal(duplicateFinalize.status, 409, 'Duplicate finalization must return HTTP 409');
    assert.ok(
      duplicateFinalize.body.message.includes('already finalized'),
      'Expected conflict message on duplicate finalize call'
    );
    console.log(`✓ Duplicate finalization blocked with HTTP 409 ("${duplicateFinalize.body.message}")`);

    // Verify Sales & Analytics COGS recognition
    console.log('  Creating customer order and verifying Sales & Analytics COGS recognition...');
    const customer = await User.create({
      name: `Customer ${suffix}`,
      email: `customer-${suffix}@labour-verify.com`,
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    });

    const order = await Order.create({
      orderNumber: `ORD-E2E-${suffix}`,
      customer: customer._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: 'Boule 750g',
          quantity: 20,
          unitPrice: 150,
          lineTotal: 3000,
        },
      ],
      subtotal: 3000,
      total: 3000,
      orderType: 'PICKUP',
      contactName: 'Cost Customer',
      contactPhone: '9876543210',
      status: 'DELIVERED',
      paymentSummary: { status: 'CAPTURED', provider: 'RAZORPAY' },
    });
    orderId = order._id;

    await ProductionBatch.updateOne(
      { _id: testBatchId },
      { $set: { relatedOrders: [order._id] } }
    );

    await Payment.create({
      order: order._id,
      customer: customer._id,
      amount: 300000,
      currency: 'INR',
      status: 'CAPTURED',
      providerOrderId: `rp-${suffix}`,
      providerPaymentId: `pay-${suffix}`,
    });

    const analyticsRes = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(analyticsRes.status, 200);
    const summary = analyticsRes.body.data.summary;
    console.log(`✓ Analytics summary retrieved: cogsStatus = ${summary.cogsStatus}, Gross Profit = ₹${summary.grossProfit}`);
    assert.ok(
      summary.cogsStatus === 'COMPUTABLE' || summary.cogsStatus === 'PARTIAL',
      `cogsStatus should be COMPUTABLE or PARTIAL, got ${summary.cogsStatus}`
    );
    assert.ok(summary.grossProfit != null, 'Gross profit must be calculated');

    // =========================================================================
    // Step 8 Verification: Check smart_bakery_db AFTER isolated test
    // =========================================================================
    console.log('\n[Step 8 Post-Check] Verifying real historical records in smart_bakery_db remain unchanged...');
    const prodConnAfter = await mongoose.createConnection('mongodb://127.0.0.1:27017/smart_bakery_db').asPromise();
    const realBatchesAfter = await prodConnAfter.collection('productionbatches').find({}, {
      projection: { batchNumber: 1, status: 1, 'costing.status': 1 }
    }).sort({ batchNumber: 1 }).toArray();

    assert.equal(realBatchesAfter.length, 9, 'Expected exactly 9 batches in smart_bakery_db');
    realBatchesAfter.forEach((b, idx) => {
      assert.equal(b.batchNumber, realBatchesBefore[idx].batchNumber);
      assert.equal(b.status, 'COMPLETED');
      assert.equal(b.costing?.status, 'NOT_FINALIZED');
    });
    console.log('✓ Confirmed: All 9 real historical batches in smart_bakery_db remain UNCHANGED and NOT_FINALIZED!');
    await prodConnAfter.close();

    console.log('\n================================================================');
    console.log('      ALL 8 VERIFICATION SCENARIOS PASSED WITH ZERO ERRORS       ');
    console.log('================================================================\n');
  } finally {
    // Clean up only our test entities in smart_bakery_db_test
    console.log('[Cleanup] Cleaning up isolated test entities from smart_bakery_db_test...');
    await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
    await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
    if (ingredient) await Ingredient.deleteOne({ _id: ingredient._id });
    if (recipe) await Recipe.deleteOne({ _id: recipe._id });
    if (product) await Product.deleteOne({ _id: product._id });
    if (category) await Category.deleteOne({ _id: category._id });
    if (orderId) {
      await Payment.deleteMany({ order: orderId });
      await Order.deleteOne({ _id: orderId });
    }
    if (product) await FinishedProductStock.deleteMany({ product: product._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@labour-verify\\.com$`) });
    await disconnectDb();
    console.log('✓ Disconnected from test database. Cleanup complete.');
  }
}

runFocusedVerification().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
