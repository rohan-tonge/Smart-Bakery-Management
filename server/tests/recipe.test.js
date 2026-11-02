process.env.NODE_ENV = "test";

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import Recipe from "../src/models/recipe.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import InventoryTransaction from "../src/models/inventoryTransaction.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import { convertQuantity } from "../src/utils/measurement.utils.js";

test("Phase 4: ingredients, recipes, and recipe scaling", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({ name: `Phase 4 ${role}`, email: `${role.toLowerCase()}-${suffix}@recipe-test.com`, password: "Password123!", role });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  const category = await Category.create({ name: `Recipe Category ${suffix}`, slug: `recipe-category-${suffix}` });
  const product = await Product.create({
    name: `Chocolate Cake ${suffix}`, slug: `chocolate-cake-${suffix}`, category: category._id,
    variants: [{ name: "1kg", quantity: 1, unit: "kg", price: 550 }],
  });
  const variantId = product.variants[0]._id.toString();
  const otherProduct = await Product.create({
    name: `Vanilla Cake ${suffix}`, slug: `vanilla-cake-${suffix}`, category: category._id,
    variants: [{ name: "500g", quantity: 500, unit: "g", price: 300 }],
  });
  const otherVariantId = otherProduct.variants[0]._id.toString();
  const validUnknownId = "000000000000000000000000";
  const createdIngredients = {};

  t.after(async () => {
    await Recipe.deleteMany({ product: { $in: [product._id, otherProduct._id] } });
    await Product.deleteMany({ _id: { $in: [product._id, otherProduct._id] } });
    await Category.deleteOne({ _id: category._id });
    const ingIds = (await Ingredient.find({ name: new RegExp(suffix) })).map((i) => i._id);
    await InventoryLot.deleteMany({ ingredient: { $in: ingIds } });
    await InventoryTransaction.deleteMany({ ingredient: { $in: ingIds } });
    await Ingredient.deleteMany({ name: new RegExp(suffix) });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@recipe-test\\.com$`) });
    await disconnectDb();
  });

  await t.test("ingredient permissions, validation, search, pagination, and update", async () => {
    const customerDenied = await request(app).post("/api/v1/ingredients").set(auth(USER_ROLES.CUSTOMER)).send({ name: "Nope", unit: "g" });
    assert.equal(customerDenied.status, 403);
    const ownerCreate = await request(app).post("/api/v1/ingredients").set(auth(USER_ROLES.OWNER)).send({ name: `  Flour   ${suffix} `, unit: "g", minimumStock: 10, reorderLevel: 20 });
    assert.equal(ownerCreate.status, 201);
    createdIngredients.flour = ownerCreate.body.data.ingredient;
    assert.equal(createdIngredients.flour.name, `Flour ${suffix}`);
    assert.equal(createdIngredients.flour.slug, `flour-${suffix}`.toLowerCase());

    const managerCreate = await request(app).post("/api/v1/ingredients").set(auth(USER_ROLES.MANAGER)).send({ name: `Sugar ${suffix}`, unit: "g" });
    assert.equal(managerCreate.status, 201);
    createdIngredients.sugar = managerCreate.body.data.ingredient;
    const cocoaCreate = await request(app).post("/api/v1/ingredients").set(auth(USER_ROLES.OWNER)).send({ name: `Cocoa ${suffix}`, unit: "g" });
    assert.equal(cocoaCreate.status, 201);
    createdIngredients.cocoa = cocoaCreate.body.data.ingredient;

    const duplicate = await request(app).post("/api/v1/ingredients").set(auth(USER_ROLES.MANAGER)).send({ name: `flour ${suffix}`, unit: "g", slug: `another-flour-${suffix}` });
    assert.equal(duplicate.status, 409);
    const badUnit = await request(app).post("/api/v1/ingredients").set(auth(USER_ROLES.OWNER)).send({ name: `Bad Unit ${suffix}`, unit: "bag" });
    assert.equal(badUnit.status, 400);
    const negative = await request(app).post("/api/v1/ingredients").set(auth(USER_ROLES.OWNER)).send({ name: `Negative ${suffix}`, unit: "g", reorderLevel: -1 });
    assert.equal(negative.status, 400);

    const list = await request(app).get(`/api/v1/ingredients?search=flour&unit=g&page=1&limit=1`).set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(list.status, 200);
    assert.equal(list.body.data.ingredients.length, 1);
    assert.equal(list.body.meta.limit, 1);
    assert.ok(list.body.meta.total >= 1);
    const managerList = await request(app).get(`/api/v1/ingredients?search=${suffix}&limit=1`).set(auth(USER_ROLES.MANAGER));
    assert.equal(managerList.status, 200);
    assert.equal(managerList.body.meta.total, 3);

    const highLimitList = await request(app).get(`/api/v1/ingredients?limit=250`).set(auth(USER_ROLES.MANAGER));
    assert.equal(highLimitList.status, 200);
    assert.ok(Array.isArray(highLimitList.body.data.ingredients));
    assert.ok(highLimitList.body.data.ingredients.some((i) => i.name === `Flour ${suffix}`));

    const updated = await request(app).patch(`/api/v1/ingredients/${createdIngredients.flour._id}`).set(auth(USER_ROLES.MANAGER)).send({ description: "Bread flour" });
    assert.equal(updated.status, 200);
    const item = await request(app).get(`/api/v1/ingredients/${createdIngredients.flour._id}`).set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(item.status, 200);
    assert.equal(item.body.data.ingredient.description, "Bread flour");
  });

  await t.test("unit conversions preserve dimensions", async () => {
    assert.equal(convertQuantity(2, "kg", "g"), 2000);
    assert.equal(convertQuantity(2, "L", "ml"), 2000);
    assert.throws(() => convertQuantity(1, "ml", "g"), /Cannot convert/);
  });

  let recipeId;
  await t.test("recipe creation rejects invalid product, variant, ingredient, and quantities", async () => {
    const payload = {
      ingredients: [{ ingredient: createdIngredients.flour._id, quantity: 500, unit: "g" }],
      expectedYield: 1, yieldUnit: "piece", productionTime: 60,
    };
    const customerDenied = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.CUSTOMER)).send(payload);
    assert.equal(customerDenied.status, 403);
    const invalidProduct = await request(app).post(`/api/v1/products/${validUnknownId}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send(payload);
    assert.equal(invalidProduct.status, 404);
    const invalidVariant = await request(app).post(`/api/v1/products/${product._id}/variants/${validUnknownId}/recipe`).set(auth(USER_ROLES.OWNER)).send(payload);
    assert.equal(invalidVariant.status, 404);
    const otherProductsVariant = await request(app).post(`/api/v1/products/${product._id}/variants/${otherVariantId}/recipe`).set(auth(USER_ROLES.OWNER)).send(payload);
    assert.equal(otherProductsVariant.status, 404);
    const invalidIngredient = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({ ...payload, ingredients: [{ ingredient: validUnknownId, quantity: 1, unit: "g" }] });
    assert.equal(invalidIngredient.status, 400);
    const duplicateIngredient = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({ ...payload, ingredients: [payload.ingredients[0], payload.ingredients[0]] });
    assert.equal(duplicateIngredient.status, 400);
    const zeroQuantity = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({ ...payload, ingredients: [{ ...payload.ingredients[0], quantity: 0 }] });
    assert.equal(zeroQuantity.status, 400);
    const incompatibleUnit = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({ ...payload, ingredients: [{ ...payload.ingredients[0], unit: "ml" }] });
    assert.equal(incompatibleUnit.status, 400);

    const missingDuration = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({
      ingredients: payload.ingredients,
      expectedYield: 1,
      yieldUnit: "piece",
    });
    assert.equal(missingDuration.status, 400);
    const zeroDuration = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({
      ...payload,
      preparationTime: 0,
      productionTime: 0,
    });
    assert.equal(zeroDuration.status, 400);
    const negativeDuration = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({
      ...payload,
      productionTime: -10,
    });
    assert.equal(negativeDuration.status, 400);
    const invalidDuration = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({
      ...payload,
      productionTime: "not-a-number",
    });
    assert.equal(invalidDuration.status, 400);
  });

  await t.test("manager creates recipe and scaling is read-only", async () => {
    const payload = {
      ingredients: [
        { ingredient: createdIngredients.flour._id, quantity: 500, unit: "g" },
        { ingredient: createdIngredients.sugar._id, quantity: 0.3, unit: "kg" },
        { ingredient: createdIngredients.cocoa._id, quantity: 100, unit: "g" },
      ],
      expectedYield: 10, yieldUnit: "piece", preparationTime: 30, productionTime: 90,
      instructions: "Mix and bake.",
    };
    const created = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.MANAGER)).send(payload);
    assert.equal(created.status, 201);
    recipeId = created.body.data.recipe._id;
    assert.equal(created.body.data.recipe.revision, 1);
    const normalizedSugar = created.body.data.recipe.ingredients.find((line) => String(line.ingredient._id) === createdIngredients.sugar._id);
    assert.equal(normalizedSugar.quantity, 300);
    assert.equal(normalizedSugar.unit, "g");

    const duplicateRecipe = await request(app).post(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send(payload);
    assert.equal(duplicateRecipe.status, 409);
    const ownerRecipe = await request(app).post(`/api/v1/products/${otherProduct._id}/variants/${otherVariantId}/recipe`).set(auth(USER_ROLES.OWNER)).send(payload);
    assert.equal(ownerRecipe.status, 201);
    const customerRead = await request(app).get(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(customerRead.status, 403);
    const productionRead = await request(app).get(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(productionRead.status, 200);
    const ownerRead = await request(app).get(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER));
    assert.equal(ownerRead.status, 200);

    const one = await request(app).post("/api/v1/recipes/calculate").set(auth(USER_ROLES.PRODUCTION_STAFF)).send({ productId: product._id, variantId, quantity: 1 });
    assert.equal(one.status, 200);
    assert.equal(one.body.data.product, product.name);
    assert.equal(one.body.data.variant, "1kg");
    assert.equal(one.body.data.expectedOutput, 10);
    assert.deepEqual(one.body.data.ingredients.map(({ name, quantity, unit }) => ({ name, quantity, unit })), [
      { name: createdIngredients.flour.name, quantity: 500, unit: "g" },
      { name: createdIngredients.sugar.name, quantity: 300, unit: "g" },
      { name: createdIngredients.cocoa.name, quantity: 100, unit: "g" },
    ]);

    const seven = await request(app).post("/api/v1/recipes/calculate").set(auth(USER_ROLES.MANAGER)).send({ productId: product._id, variantId, quantity: 7 });
    assert.equal(seven.status, 200);
    assert.equal(seven.body.data.expectedOutput, 70);
    assert.deepEqual(seven.body.data.ingredients.map((line) => line.quantity), [3500, 2100, 700]);
    const invalidQuantity = await request(app).post("/api/v1/recipes/calculate").set(auth(USER_ROLES.OWNER)).send({ productId: product._id, variantId, quantity: 0 });
    assert.equal(invalidQuantity.status, 400);

    const unchanged = await Recipe.findById(recipeId);
    assert.deepEqual(unchanged.ingredients.map((line) => line.quantity), [500, 300, 100]);
    assert.equal(await Ingredient.countDocuments({ name: new RegExp(suffix) }), 3);
    const ownerUpdate = await request(app).patch(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({ productionTime: 95 });
    assert.equal(ownerUpdate.status, 200);
    assert.equal(ownerUpdate.body.data.recipe.revision, 2);
    assert.equal(ownerUpdate.body.data.recipe.productionTime, 95);

    const zeroUpdate = await request(app).patch(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({ preparationTime: 0, productionTime: 0 });
    assert.equal(zeroUpdate.status, 400);

    const negativeUpdate = await request(app).patch(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({ productionTime: -20 });
    assert.equal(negativeUpdate.status, 400);

    const aliasUpdate = await request(app).patch(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.OWNER)).send({ duration: 50 });
    assert.equal(aliasUpdate.status, 200);
    assert.equal(aliasUpdate.body.data.recipe.productionTime, 50);
  });

  await t.test("checkout feasibility validates recipe duration and active recipe per product", async () => {
    // 1. Variant without an active recipe
    const noRecipeFeasibility = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({
      items: [{ productId: product._id, variantId: validUnknownId, quantity: 1 }],
    });
    assert.equal(noRecipeFeasibility.body.data.feasible, false);

    // 2. Recipe temporarily set to 0 duration
    await Recipe.updateOne({ _id: recipeId }, { $set: { preparationTime: 0, productionTime: 0 } });
    const zeroDurationFeasibility = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({
      items: [{ productId: product._id, variantId, quantity: 1 }],
    });
    assert.equal(zeroDurationFeasibility.body.data.feasible, false);
    const zeroDurationItem = zeroDurationFeasibility.body.data.items?.find((i) => String(i.variantId) === String(variantId));
    assert.equal(zeroDurationItem.valid, false);
    assert.equal(zeroDurationItem.issue, "RECIPE_DURATION_REQUIRED");
    assert.match(zeroDurationItem.message, /must define a positive preparation or production duration/i);

    // Restore positive duration
    await Recipe.updateOne({ _id: recipeId }, { $set: { preparationTime: 15, productionTime: 45 } });
    const validFeasibility = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({
      items: [{ productId: product._id, variantId, quantity: 1 }],
    });
    const validItem = validFeasibility.body.data.items?.find((i) => String(i.variantId) === String(variantId));
    assert.equal(validItem.valid, true);
  });

  await t.test("inline ingredient setup with optional opening stock and recipe integration", async () => {
    // 1. Create ingredient with opening stock
    const customLot = `LOT-TEST-${suffix}`;
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const createRes = await request(app)
      .post("/api/v1/ingredients")
      .set(auth(USER_ROLES.OWNER))
      .send({
        name: `Baking Powder ${suffix}`,
        unit: "g",
        minimumStock: 100,
        reorderLevel: 200,
        description: "Fresh baking powder",
        openingStock: 500,
        openingStockUnit: "g",
        openingStockCost: 150,
        openingStockExpiryDate: expiry,
        openingStockLotNumber: customLot,
      });

    assert.equal(createRes.status, 201);
    const newIng = createRes.body.data.ingredient;
    assert.equal(newIng.name, `Baking Powder ${suffix}`);
    assert.equal(newIng.currentStock, 500);

    // 2. Verify InventoryLot was created with status AVAILABLE, custom lotNumber, and unitCost
    const lot = await InventoryLot.findOne({ ingredient: newIng._id });
    assert.ok(lot, "Inventory lot should exist for opening stock");
    assert.equal(lot.status, "AVAILABLE");
    assert.equal(lot.lotNumber, customLot);
    assert.equal(lot.remainingQuantity, 500);
    assert.equal(lot.unitCost, 150);

    // 3. Verify InventoryTransaction was created as ADJUSTMENT / IN
    const tx = await InventoryTransaction.findOne({ ingredient: newIng._id });
    assert.ok(tx, "Inventory transaction ledger entry should exist");
    assert.equal(tx.type, "ADJUSTMENT");
    assert.equal(tx.direction, "IN");
    assert.equal(tx.quantity, 500);

    // 4. Verify stock reflects in GET /api/v1/inventory
    const invRes = await request(app).get(`/api/v1/inventory?search=Baking+Powder+${suffix}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(invRes.status, 200);
    const foundStock = invRes.body.data.inventory.find((i) => String(i._id) === String(newIng._id));
    assert.ok(foundStock);
    assert.equal(foundStock.currentStock, 500);

    // 5. Update recipe referencing this new ingredient for 1 unit of product
    const patchRes = await request(app)
      .patch(`/api/v1/products/${product._id}/variants/${variantId}/recipe`)
      .set(auth(USER_ROLES.MANAGER))
      .send({
        expectedYield: 1,
        yieldUnit: "kg",
        preparationTime: 20,
        productionTime: 40,
        instructions: "Updated with newly created ingredient.",
        ingredients: [
          { ingredient: newIng._id, quantity: 50, unit: "g" },
        ],
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.data.recipe.expectedYield, 1);
    assert.equal(patchRes.body.data.recipe.ingredients.length, 1);
    assert.equal(String(patchRes.body.data.recipe.ingredients[0].ingredient._id), String(newIng._id));

    // Clean up created ingredient so subsequent count assertions remain unchanged
    await Ingredient.deleteOne({ _id: newIng._id });
    await InventoryLot.deleteMany({ ingredient: newIng._id });
    await InventoryTransaction.deleteMany({ ingredient: newIng._id });
  });

  await t.test("ingredient and recipe deactivation preserve records", async () => {
    const deactivatedRecipe = await request(app).delete(`/api/v1/products/${product._id}/variants/${variantId}/recipe`).set(auth(USER_ROLES.MANAGER));
    assert.equal(deactivatedRecipe.status, 200);
    assert.equal(deactivatedRecipe.body.data.recipe.isActive, false);
    const noActiveRecipe = await request(app).post("/api/v1/recipes/calculate").set(auth(USER_ROLES.OWNER)).send({ productId: product._id, variantId, quantity: 1 });
    assert.equal(noActiveRecipe.status, 404);

    const deactivatedIngredient = await request(app).delete(`/api/v1/ingredients/${createdIngredients.flour._id}`).set(auth(USER_ROLES.OWNER));
    assert.equal(deactivatedIngredient.status, 200);
    assert.equal(deactivatedIngredient.body.data.ingredient.isActive, false);
    const productionList = await request(app).get(`/api/v1/ingredients?search=${suffix}`).set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(productionList.body.meta.total, 2);
    const managerInactive = await request(app).get(`/api/v1/ingredients?search=${suffix}&isActive=false`).set(auth(USER_ROLES.MANAGER));
    assert.equal(managerInactive.body.meta.total, 1);
  });
});
