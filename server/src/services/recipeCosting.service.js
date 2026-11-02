import Ingredient from "../models/ingredient.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import { areUnitsConvertible, convertQuantity } from "../utils/measurement.utils.js";
import { rupeesToPaise, paiseToRupees } from "../utils/money.utils.js";

/**
 * Authoritative Recipe Costing & Profitability Service
 * 
 * Implements:
 * - Ingredient cost from actual recipe quantities & ingredient lot costs
 * - Labour cost = labour minutes * labour cost per minute
 * - Power cost = power minutes * power cost per minute
 * - Packaging cost = packaging count * packaging cost per unit
 * - Total batch cost = ingredient + labour + power + packaging
 * - Unit cost = total batch cost / expected yield
 * - Material-only unit cost = ingredient cost / expected yield
 * - Gross profit = selling price - total unit cost
 * - Gross margin % = (selling price - total unit cost) / selling price * 100
 * - Markup % = (selling price - total unit cost) / total unit cost * 100
 */
class RecipeCostingService {
  /**
   * Get the current effective unit cost for an ingredient (from latest inventory lot or default)
   */
  async getIngredientEffectiveCost(ingredientId) {
    const lot = await InventoryLot.findOne({
      ingredient: ingredientId,
      status: "AVAILABLE",
      remainingQuantity: { $gt: 0 },
    }).sort({ purchaseDate: -1, createdAt: -1 }).lean();

    if (lot && typeof lot.unitCost === "number" && !isNaN(lot.unitCost)) {
      return { unitCost: lot.unitCost, unit: lot.unit };
    }

    // Fallback: check any lot for this ingredient
    const anyLot = await InventoryLot.findOne({ ingredient: ingredientId })
      .sort({ createdAt: -1 })
      .lean();
    if (anyLot && typeof anyLot.unitCost === "number" && !isNaN(anyLot.unitCost)) {
      return { unitCost: anyLot.unitCost, unit: anyLot.unit };
    }

    const ing = await Ingredient.findById(ingredientId).lean();
    const fallbackCost = ing?.costPerUnit ?? ing?.pricePerUnit ?? 0;
    return { unitCost: Number(fallbackCost) || 0, unit: ing?.unit || "g" };
  }

  /**
   * Calculate complete costing and profitability for a recipe
   * @param {Object} recipe - Recipe document or plain object
   * @param {number} sellingPrice - Selling price of the variant or product
   * @param {Object} product - Product document or plain object
   * @returns {Object} Costing breakdown with material and fully loaded costs
   */
  async calculateRecipeCosting(recipe, sellingPrice = 0, product = null) {
    if (!recipe) return null;

    let prodDoc = product;
    if (!prodDoc && recipe.product) {
      try {
        const Product = (await import("../models/product.model.js")).default;
        prodDoc = await Product.findById(recipe.product).lean();
      } catch {
        // ignore
      }
    }

    const expectedYield = Number(recipe.expectedYield) || 1;
    const yieldUnit = recipe.yieldUnit || "piece";

    // 1. Calculate ingredient costs
    let ingredientCostPaise = 0;
    const ingredientBreakdown = [];

    if (Array.isArray(recipe.ingredients)) {
      for (const line of recipe.ingredients) {
        const ingId = line.ingredient?._id || line.ingredient;
        if (!ingId) continue;

        const { unitCost: lotUnitCost, unit: lotUnit } = await this.getIngredientEffectiveCost(ingId);
        const lineUnit = line.unit || lotUnit;
        const lineQuantity = Number(line.quantity) || 0;

        let quantityInLotUnit = lineQuantity;
        if (areUnitsConvertible(lineUnit, lotUnit)) {
          quantityInLotUnit = convertQuantity(lineQuantity, lineUnit, lotUnit);
        }

        const lineCostRupees = quantityInLotUnit * lotUnitCost;
        const lineCostPaise = Math.round(lineCostRupees * 100);
        ingredientCostPaise += lineCostPaise;

        ingredientBreakdown.push({
          ingredient: ingId,
          name: line.ingredient?.name || line.name || "Ingredient",
          quantity: lineQuantity,
          unit: lineUnit,
          unitCost: lotUnitCost,
          lotUnit,
          cost: paiseToRupees(lineCostPaise),
        });
      }
    }

    const ingredientCost = paiseToRupees(ingredientCostPaise);

    // Check if product per-unit costing is active
    const electricityCostPerUnit = Number(prodDoc?.electricityCostPerUnit ?? recipe.electricityCostPerUnit ?? 0);
    const packagingCostPerUnit = Number(prodDoc?.packagingCostPerUnit ?? recipe.packagingCostPerUnit ?? 0);
    const hasPerUnitCosting = electricityCostPerUnit > 0 || packagingCostPerUnit > 0;

    const prepMinutes = Number(recipe.preparationTime) || 0;
    const prodMinutes = Number(recipe.productionTime) || 0;
    const totalDuration = prepMinutes + prodMinutes;
    const labourMinutes = recipe.labourMinutes != null ? Number(recipe.labourMinutes) : totalDuration;
    let labourRatePerMinute = Number(recipe.labourCostPerMinute) || 0;
    let labourCost = 0;
    let labourCostPaise = 0;

    const powerMinutes = recipe.powerMinutes != null ? Number(recipe.powerMinutes) : prodMinutes;
    const powerKw = Number(recipe.equipmentPowerKw) || 2.0;
    const tariff = Number(recipe.electricityTariff) || 8.0;
    let powerCost = 0;
    let powerRatePerMinute = Number(recipe.powerCostPerMinute) || 0;

    let packagingCost = 0;
    let packagingQuantity = recipe.packagingQuantity != null ? Number(recipe.packagingQuantity) : expectedYield;
    let packagingRate = Number(recipe.packagingCostPerUnit) || 0;
    const packagingBreakdown = [];

    if (hasPerUnitCosting) {
      // Direct formula: Total production cost = Total ingredient cost + Total electricity cost + Total packaging cost
      powerCost = Number((expectedYield * electricityCostPerUnit).toFixed(2));
      packagingCost = Number((expectedYield * packagingCostPerUnit).toFixed(2));
      packagingRate = packagingCostPerUnit;
      labourCost = 0;
      labourRatePerMinute = 0;

      if (packagingCost > 0) {
        packagingBreakdown.push({
          name: "Product Packaging Setting",
          consumptionType: "PER_PIECE",
          quantityUsed: expectedYield,
          costPerUnit: packagingCostPerUnit,
          cost: packagingCost,
        });
      }
    } else {
      // Legacy labour and machine power calculation
      labourCost = Number((labourMinutes * labourRatePerMinute).toFixed(2));
      if (recipe.powerCostPerMinute > 0) {
        powerCost = Number((powerMinutes * powerRatePerMinute).toFixed(2));
      } else {
        const runtimeHours = powerMinutes / 60;
        powerCost = Number((powerKw * runtimeHours * tariff).toFixed(2));
        powerRatePerMinute = Number(((powerKw * tariff) / 60).toFixed(4));
      }

      if (Array.isArray(recipe.packagingMaterials) && recipe.packagingMaterials.length > 0) {
        for (const mat of recipe.packagingMaterials) {
          const unitsPerItem = Number(mat.unitsPerItem) || 1;
          const matCostPerUnit = Number(mat.costPerUnit) || 0;
          const qtyUsed = mat.consumptionType === "PER_BATCH" ? unitsPerItem : expectedYield * unitsPerItem;
          const lineCost = Number((qtyUsed * matCostPerUnit).toFixed(2));
          packagingCost += lineCost;
          packagingBreakdown.push({
            name: mat.name,
            consumptionType: mat.consumptionType || "PER_PIECE",
            quantityUsed: qtyUsed,
            costPerUnit: matCostPerUnit,
            cost: lineCost,
          });
        }
        packagingCost = Number(packagingCost.toFixed(2));
        packagingRate = expectedYield > 0 ? Number((packagingCost / expectedYield).toFixed(2)) : 0;
      } else {
        packagingCost = Number((packagingQuantity * packagingRate).toFixed(2));
        if (packagingCost > 0) {
          packagingBreakdown.push({
            name: "Standard Piece Packaging",
            consumptionType: "PER_PIECE",
            quantityUsed: packagingQuantity,
            costPerUnit: packagingRate,
            cost: packagingCost,
          });
        }
      }
    }

    labourCostPaise = Math.round(labourCost * 100);
    const powerCostPaise = Math.round(powerCost * 100);
    const packagingCostPaise = Math.round(packagingCost * 100);

    // 5. Total Batch Cost
    const totalBatchCostPaise = ingredientCostPaise + labourCostPaise + powerCostPaise + packagingCostPaise;
    const totalBatchCost = paiseToRupees(totalBatchCostPaise);

    // 6. Unit Costs
    const unitCost = expectedYield > 0 ? Number((totalBatchCost / expectedYield).toFixed(2)) : 0;
    const materialOnlyUnitCost = expectedYield > 0 ? Number((ingredientCost / expectedYield).toFixed(2)) : 0;

    // 7. Selling Price, Gross Profit, and Gross Margin %
    const price = Number(sellingPrice) || 0;
    const grossProfit = Number((price - unitCost).toFixed(2));
    const materialGrossProfit = Number((price - materialOnlyUnitCost).toFixed(2));

    let grossMarginPercentage = 0;
    if (price > 0) {
      grossMarginPercentage = Number((((price - unitCost) / price) * 100).toFixed(2));
    }

    let markupPercentage = 0;
    if (unitCost > 0) {
      markupPercentage = Number((((price - unitCost) / unitCost) * 100).toFixed(2));
    }

    return {
      expectedYield,
      yieldUnit,
      quantity: expectedYield,
      ingredientCost,
      electricityCost: powerCost,
      packagingCost,
      totalProductionCost: totalBatchCost,
      totalCost: totalBatchCost,
      totalUnitCost: unitCost,
      unitCost,
      costPerUnit: unitCost,
      electricityCostPerUnit,
      packagingCostPerUnit,
      labourMinutes,
      powerMinutes,
      packagingQuantity,
      rates: {
        labourCostPerMinute: labourRatePerMinute,
        powerCostPerMinute: powerRatePerMinute,
        electricityCostPerUnit,
        packagingCostPerUnit: hasPerUnitCosting ? packagingCostPerUnit : packagingRate,
        packagingCostPerUnitLegacy: packagingRate,
      },
      costs: {
        ingredientCost,
        labourCost,
        powerCost,
        electricityCost: powerCost,
        packagingCost,
        totalBatchCost,
        totalProductionCost: totalBatchCost,
        totalCost: totalBatchCost,
        materialOnlyUnitCost,
        unitCost,
        totalUnitCost: unitCost,
        costPerUnit: unitCost,
      },
      profitability: {
        sellingPrice: price,
        grossProfit,
        grossMarginPercentage,
        markupPercentage,
        materialGrossProfit,
      },
      ingredientBreakdown,
      packagingBreakdown,
      electricity: {
        powerKw,
        runtimeMinutes: powerMinutes,
        tariffPerKwh: tariff,
        energyKwh: Number((powerKw * (powerMinutes / 60)).toFixed(4)),
        cost: powerCost,
        costPerUnit: electricityCostPerUnit,
      },
    };
  }
}

export const recipeCostingService = new RecipeCostingService();
export default recipeCostingService;
