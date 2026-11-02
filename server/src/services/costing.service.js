import mongoose from "mongoose";
import Product from "../models/product.model.js";
import Recipe from "../models/recipe.model.js";
import Ingredient from "../models/ingredient.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import ProductionBatch from "../models/productionBatch.model.js";
import WastageRecord from "../models/wastageRecord.model.js";
import User from "../models/user.model.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import { inventoryService } from "./inventory.service.js";
import AppError from "../utils/appError.js";
import {
  areUnitsConvertible,
  convertQuantity,
} from "../utils/measurement.utils.js";
import {
  multiplyQuantityByRupees,
  paiseToRupees,
  rupeesToPaise,
  sumSafePaise,
} from "../utils/money.utils.js";

const assertId = (id, label = "ID") => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest(`Invalid ${label}`);
};
const nowAvailable = () => ({
  $or: [{ expiryDate: null }, { expiryDate: { $gt: new Date() } }],
});
const amount = (paise) => paiseToRupees(paise);
const summaryMath = (revenuePaise, costPaise) => ({
  revenue: amount(revenuePaise),
  productionCost: amount(costPaise),
  profit: amount(revenuePaise - costPaise),
  marginPercentage:
    revenuePaise > 0
      ? Number((((revenuePaise - costPaise) / revenuePaise) * 100).toFixed(2))
      : null,
  marginStatus: revenuePaise > 0 ? "COMPUTABLE" : "UNAVAILABLE",
});

class CostingService {
  async actualComponents(
    batch,
    { packagingCostPaise: overridePackagingCostPaise, expenses = [], recordedBy } = {},
  ) {
    const incomplete = [];
    if (!batch.consumedIngredients.length)
      incomplete.push(
        "No actual ingredient consumption is recorded for this batch",
      );
    const materialSnapshots = [];
    let consumedMaterialPaise = 0;
    for (const line of batch.consumedIngredients) {
      if (!Number.isFinite(line.unitCostSnapshot)) {
        incomplete.push(
          `Missing historical lot cost for ${line.ingredientName}`,
        );
        continue;
      }
      const costPaise = multiplyQuantityByRupees(
        line.quantity,
        line.unitCostSnapshot,
      );
      consumedMaterialPaise = sumSafePaise([consumedMaterialPaise, costPaise]);
      materialSnapshots.push({
        ingredient: line.ingredient,
        ingredientName: line.ingredientName,
        lot: line.lot,
        lotNumber: line.lotNumber,
        purchase: line.purchase || null,
        vendor: line.vendor || null,
        supplierNameSnapshot: line.supplierNameSnapshot || "",
        quantity: line.quantity,
        unit: line.unit,
        unitCostSnapshot: line.unitCostSnapshot,
        costPaise,
      });
    }
    const rawWaste = await WastageRecord.find({
      productionBatch: batch._id,
      type: "RAW_MATERIAL",
      status: "RECORDED",
    });
    const rawWastePaise = sumSafePaise(rawWaste.map((item) => item.valuePaise));
    const ingredientCostPaise = sumSafePaise([
      consumedMaterialPaise,
      rawWastePaise,
    ]);
    const hasEquipmentPowerOrMaterials =
      Number(batch.recipeSnapshot?.equipmentPowerKw) > 0 ||
      (Array.isArray(batch.recipeSnapshot?.packagingMaterials) && batch.recipeSnapshot.packagingMaterials.length > 0);

    const hasProductUnitCosts =
      Number(batch.productSnapshot?.electricityCostPerUnit) > 0 ||
      Number(batch.productSnapshot?.packagingCostPerUnit) > 0;

    const isProductCostingBatch =
      !hasEquipmentPowerOrMaterials && hasProductUnitCosts;

    if (isProductCostingBatch) {
      const electricityCostPerUnit = Number(batch.productSnapshot.electricityCostPerUnit) || 0;
      const packagingCostPerUnit = Number(batch.productSnapshot.packagingCostPerUnit) || 0;
      const preparationTimePerUnit = Number(batch.productSnapshot.preparationTimePerUnit) || 0;

      // Determine actual finished quantity Q
      let actualFinishedQuantity = 0;
      if (batch.usableQuantity !== undefined && batch.usableQuantity !== null) {
        actualFinishedQuantity = Number(batch.usableQuantity);
      } else if (batch.packagedQuantity !== undefined && batch.packagedQuantity !== null) {
        actualFinishedQuantity = Number(batch.packagedQuantity);
      } else if (batch.producedQuantity !== undefined && batch.producedQuantity !== null) {
        actualFinishedQuantity = Number(batch.producedQuantity);
      } else if (batch.plannedQuantity !== undefined && batch.plannedQuantity !== null) {
        actualFinishedQuantity = Number(batch.plannedQuantity);
      }
      if (!Number.isFinite(actualFinishedQuantity) || actualFinishedQuantity < 0) {
        actualFinishedQuantity = 0;
      }

      // New costing formula:
      // 1. Ingredient Cost = actual ingredient consumption
      // 2. Electricity Cost = configured electricity cost per unit × Q
      // 3. Packaging Cost = configured packaging cost per unit × Q
      // 4. Total Production Cost = Ingredient Cost + Electricity Cost + Packaging Cost
      // 5. Cost per Unit = Total Production Cost ÷ actual finished quantity (when Q > 0)
      const electricityCostPaise = actualFinishedQuantity > 0 && electricityCostPerUnit > 0
        ? multiplyQuantityByRupees(actualFinishedQuantity, electricityCostPerUnit)
        : 0;

      const packagingCostPaise = actualFinishedQuantity > 0 && packagingCostPerUnit > 0
        ? multiplyQuantityByRupees(actualFinishedQuantity, packagingCostPerUnit)
        : 0;

      const totalCostPaise = sumSafePaise([
        ingredientCostPaise,
        electricityCostPaise,
        packagingCostPaise,
      ]);

      const costPerUsableItemPaise =
        actualFinishedQuantity > 0
          ? Math.round(totalCostPaise / actualFinishedQuantity)
          : null;

      const electricitySnapshot = {
        equipmentName: "Product Electricity Setting",
        powerKw: 0,
        runtimeMinutes: 0,
        runtimeHours: 0,
        tariffPerKwh: 0,
        energyKwh: 0,
        costPerUnit: electricityCostPerUnit,
        costPaise: electricityCostPaise,
        basis: "PRODUCT_CONFIGURED",
      };

      const packagingSnapshots = [
        {
          materialName: "Product Packaging Setting",
          consumptionType: "PER_PIECE",
          quantityUsed: actualFinishedQuantity,
          costPerUnit: packagingCostPerUnit,
          costPaise: packagingCostPaise,
        },
      ];
      const packagingBasis = "PRODUCT_CONFIGURED";

      // Build labour audit snapshots (labour cost is 0 in the new formula)
      const labourSnapshots = [];
      if (Array.isArray(batch.assignedWorkers)) {
        for (const assignment of batch.assignedWorkers) {
          const worker = await User.findById(assignment.worker).select("name");
          const workerName = worker?.name || "Former worker";
          labourSnapshots.push({
            worker: assignment.worker,
            workerName,
            hourlyRateSnapshot: assignment.hourlyRateSnapshot ?? null,
            actualHours: assignment.actualHours ?? null,
            costPaise: 0,
          });
        }
      }

      return {
        incomplete,
        materialSnapshots,
        labourSnapshots,
        ingredientCostPaise,
        labourCostPaise: 0,
        packagingCostPaise,
        electricityCostPaise,
        electricityCostPerUnit,
        packagingCostPerUnit,
        preparationTimePerUnit,
        actualFinishedQuantity,
        electricitySnapshot,
        packagingSnapshots,
        packagingBasis,
        otherExpensePaise: 0,
        totalCostPaise,
        wastageCostPaise: rawWastePaise,
        costPerUsableItemPaise,
        costPerUsableItemStatus:
          costPerUsableItemPaise === null ? "UNAVAILABLE" : "COMPUTABLE",
        expenses: [],
        rawWastePaise,
        outputWastePaise: 0,
        wastagePercentage:
          batch.producedQuantity > 0
            ? Number(
                ((batch.wastageQuantity / batch.producedQuantity) * 100).toFixed(
                  2,
                ),
              )
            : null,
      };
    }

    // --- LEGACY BATCH COSTING LOGIC (Preserved for Historical Batches) ---
    const labourSnapshots = [];
    let labourCostPaise = 0;
    for (const assignment of batch.assignedWorkers || []) {
      const worker = await User.findById(assignment.worker).select("name");
      const workerName = worker?.name || "Former worker";
      let workerIncomplete = false;
      let effectiveHours = assignment.actualHours;
      if (
        effectiveHours === null ||
        effectiveHours === undefined
      ) {
        const startTime = batch.actualStartTime || batch.verifiedAt;
        const endTime = batch.packagedAt || batch.actualCompletionTime;
        if (startTime && endTime) {
          const diffMs = new Date(endTime).getTime() - new Date(startTime).getTime();
          effectiveHours = Math.max(0.01, Number((diffMs / (1000 * 60 * 60)).toFixed(2)));
        } else {
          incomplete.push(
            `Missing actual hours for assigned worker ${workerName}`,
          );
          workerIncomplete = true;
        }
      }
      if (
        assignment.hourlyRateSnapshot === null ||
        assignment.hourlyRateSnapshot === undefined
      ) {
        incomplete.push(
          `Missing hourly rate snapshot for assigned worker ${workerName}`,
        );
        workerIncomplete = true;
      }
      if (workerIncomplete) continue;
      const costPaise = multiplyQuantityByRupees(
        effectiveHours,
        assignment.hourlyRateSnapshot,
      );
      labourCostPaise = sumSafePaise([labourCostPaise, costPaise]);
      labourSnapshots.push({
        worker: assignment.worker,
        workerName,
        hourlyRateSnapshot: assignment.hourlyRateSnapshot,
        actualHours: effectiveHours,
        costPaise,
      });
    }

    let recipeDoc = null;
    const getRecipeDoc = async () => {
      if (!recipeDoc && batch.recipe) {
        recipeDoc = await Recipe.findById(batch.recipe);
      }
      return recipeDoc;
    };

    let powerKw = Number(batch.recipeSnapshot?.equipmentPowerKw);
    let tariffPerKwh = Number(batch.recipeSnapshot?.electricityTariff);
    let isKwConfigured = Number.isFinite(powerKw) && powerKw > 0;

    if (!isKwConfigured) {
      const r = await getRecipeDoc();
      if (r?.equipmentPowerKw !== undefined && r?.equipmentPowerKw !== null && Number(r.equipmentPowerKw) > 0) {
        powerKw = Number(r.equipmentPowerKw);
        tariffPerKwh = Number(batch.recipeSnapshot?.electricityTariff || r.electricityTariff || 8.0);
        isKwConfigured = true;
      }
    }

    let electricityCostPaise = 0;
    let electricitySnapshot = null;

    if (isKwConfigured) {
      if (!Number.isFinite(tariffPerKwh) || tariffPerKwh <= 0) {
        tariffPerKwh = 8.0;
      }

      let runtimeMinutes = 0;
      if (batch.equipmentRuntimeMinutes !== undefined && batch.equipmentRuntimeMinutes !== null && batch.equipmentRuntimeMinutes > 0) {
        runtimeMinutes = Number(batch.equipmentRuntimeMinutes);
      } else if (batch.bakingStartTime && batch.bakingEndTime) {
        const diffMs = new Date(batch.bakingEndTime).getTime() - new Date(batch.bakingStartTime).getTime();
        runtimeMinutes = Math.max(1, Math.round(diffMs / 60000));
      } else {
        const r = await getRecipeDoc();
        runtimeMinutes = Number(batch.recipeSnapshot?.productionTime || r?.productionTime || 30);
      }

      const runtimeHours = Number((runtimeMinutes / 60).toFixed(4));
      const energyKwh = Number((powerKw * runtimeHours).toFixed(4));
      electricityCostPaise = Math.round(energyKwh * tariffPerKwh * 100);

      electricitySnapshot = {
        equipmentName: "Commercial Baking Oven",
        powerKw,
        runtimeMinutes,
        runtimeHours,
        tariffPerKwh,
        energyKwh,
        costPaise: electricityCostPaise,
        basis: "MEASURED_EQUIPMENT_RUNTIME",
      };
    } else {
      const r = await getRecipeDoc();
      const legacyMinutes = Number(batch.recipeSnapshot?.powerMinutes || r?.powerMinutes);
      const legacyRate = Number(batch.recipeSnapshot?.powerCostPerMinute || r?.powerCostPerMinute);

      if (legacyMinutes > 0 && legacyRate > 0) {
        electricityCostPaise = Math.round(legacyMinutes * legacyRate * 100);
        electricitySnapshot = {
          equipmentName: "Commercial Baking Oven",
          powerKw: 0,
          runtimeMinutes: legacyMinutes,
          runtimeHours: Number((legacyMinutes / 60).toFixed(4)),
          tariffPerKwh: 0,
          energyKwh: 0,
          costPaise: electricityCostPaise,
          basis: "LEGACY_POWER_MINUTES",
        };
      } else {
        electricityCostPaise = 0;
        electricitySnapshot = {
          equipmentName: "Commercial Baking Oven",
          powerKw: 0,
          runtimeMinutes: 0,
          runtimeHours: 0,
          tariffPerKwh: 0,
          energyKwh: 0,
          costPaise: 0,
          powerRatingMissing: true,
          tariffMissing: true,
          basis: "NOT_CONFIGURED",
        };
      }
    }

    const packagedPieces = batch.packagedQuantity || batch.usableQuantity || batch.producedQuantity || batch.plannedQuantity || 1;
    const packagingSnapshots = [];
    let packagingBasis = "PIECE_BASED";
    let calcPackagingCostPaise = 0;

    let materialsSource = [];
    if (Array.isArray(batch.packagingMaterialsUsed) && batch.packagingMaterialsUsed.length > 0) {
      materialsSource = batch.packagingMaterialsUsed;
      packagingBasis = "ITEMIZED_MATERIALS";
    } else if (Array.isArray(batch.recipeSnapshot?.packagingMaterials) && batch.recipeSnapshot.packagingMaterials.length > 0) {
      materialsSource = batch.recipeSnapshot.packagingMaterials;
      packagingBasis = "ITEMIZED_MATERIALS";
    } else {
      const r = await getRecipeDoc();
      if (Array.isArray(r?.packagingMaterials) && r.packagingMaterials.length > 0) {
        materialsSource = r.packagingMaterials;
        packagingBasis = "ITEMIZED_MATERIALS";
      }
    }

    if (materialsSource.length > 0) {
      for (const m of materialsSource) {
        const matName = m.materialName || m.name || "Packaging Material";
        const cType = m.consumptionType === "PER_BATCH" ? "PER_BATCH" : "PER_PIECE";
        const costPerUnit = Number(m.costPerUnit) || 0;
        let qtyUsed = 0;
        if (m.quantityUsed !== undefined && m.quantityUsed !== null) {
          qtyUsed = Number(m.quantityUsed);
        } else {
          const unitsPerItem = Number(m.unitsPerItem) || 1;
          qtyUsed = cType === "PER_BATCH" ? unitsPerItem : unitsPerItem * packagedPieces;
        }
        const matCostPaise = Math.round(qtyUsed * costPerUnit * 100);
        calcPackagingCostPaise = sumSafePaise([calcPackagingCostPaise, matCostPaise]);
        packagingSnapshots.push({
          materialName: matName,
          consumptionType: cType,
          quantityUsed: qtyUsed,
          costPerUnit,
          costPaise: matCostPaise,
        });
      }
    } else {
      let perUnitRate = Number(batch.recipeSnapshot?.packagingCostPerUnit);
      if (!Number.isFinite(perUnitRate) || perUnitRate < 0) {
        const r = await getRecipeDoc();
        perUnitRate = Number(r?.packagingCostPerUnit) || 0;
      }
      calcPackagingCostPaise = Math.round(perUnitRate * packagedPieces * 100);
      packagingBasis = "PIECE_BASED";
      if (calcPackagingCostPaise > 0) {
        packagingSnapshots.push({
          materialName: "Standard Packaging",
          consumptionType: "PER_PIECE",
          quantityUsed: packagedPieces,
          costPerUnit: perUnitRate,
          costPaise: calcPackagingCostPaise,
        });
      }
    }

    const finalPackagingCostPaise =
      overridePackagingCostPaise !== undefined && overridePackagingCostPaise !== null
        ? overridePackagingCostPaise
        : calcPackagingCostPaise;

    const filteredExpenses = (expenses || []).filter((e) => {
      const desc = (e.description || "").toLowerCase();
      if (electricityCostPaise > 0 && (desc.includes("electricity") || desc.includes("energy rate") || desc.includes("power cost"))) {
        return false;
      }
      return true;
    });

    const otherExpensePaise = sumSafePaise(
      filteredExpenses.map((expense) => expense.amountPaise),
    );

    const totalCostPaise = sumSafePaise([
      ingredientCostPaise,
      labourCostPaise,
      finalPackagingCostPaise,
      electricityCostPaise,
      otherExpensePaise,
    ]);

    const costPerUsableItemPaise =
      batch.usableQuantity > 0
        ? Math.round(totalCostPaise / batch.usableQuantity)
        : null;

    const outputWasteRecord = await WastageRecord.exists({
      productionBatch: batch._id,
      type: "PRODUCTION_OUTPUT",
      status: "RECORDED",
    });
    if (batch.wastageQuantity > 0 && !outputWasteRecord)
      incomplete.push(
        "Record the production output wastage reason before finalizing cost",
      );
    const outputWastePaise =
      costPerUsableItemPaise !== null
        ? Math.round(costPerUsableItemPaise * (batch.wastageQuantity || 0))
        : 0;
    const wastageCostPaise = sumSafePaise([rawWastePaise, outputWastePaise]);
    return {
      incomplete,
      materialSnapshots,
      labourSnapshots,
      ingredientCostPaise,
      labourCostPaise,
      packagingCostPaise: finalPackagingCostPaise,
      electricityCostPaise,
      electricitySnapshot,
      packagingSnapshots,
      packagingBasis,
      otherExpensePaise,
      totalCostPaise,
      wastageCostPaise,
      costPerUsableItemPaise,
      costPerUsableItemStatus:
        costPerUsableItemPaise === null ? "UNAVAILABLE" : "COMPUTABLE",
      expenses: filteredExpenses,
      rawWastePaise,
      outputWastePaise,
      wastagePercentage:
        batch.producedQuantity > 0
          ? Number(
              ((batch.wastageQuantity / batch.producedQuantity) * 100).toFixed(
                2,
              ),
            )
          : null,
    };
  }
  async buildWorkerSummaries(batch) {
    if (!Array.isArray(batch.assignedWorkers)) return [];
    return Promise.all(
      batch.assignedWorkers.map(async (a) => {
        const u = await User.findById(a.worker).select("name email hourlyLabourRate");
        return {
          workerId: a.worker,
          name: u?.name || "Staff Member",
          email: u?.email || "",
          currentLabourRate: u?.hourlyLabourRate ?? null,
          hourlyRateSnapshot: a.hourlyRateSnapshot ?? null,
          actualHours: a.actualHours ?? null,
          task: a.task || "",
          taskStatus: a.taskStatus || "PENDING",
        };
      })
    );
  }
  async getBatchCost(id) {
    assertId(id, "batch ID");
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");
    if (batch.costing.status === "FINALIZED")
      return {
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        costType: "ACTUAL",
        ...(await this.presentSnapshot(batch)),
        incomplete: [],
      };
    if (batch.costing.status === "FINALIZING")
      return {
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        costType: "ACTUAL",
        status: "FINALIZING",
        incomplete: ["Cost finalization is currently in progress"],
      };
    if (
      batch.status !== "QUALITY_FAILED" &&
      batch.status !== "COMPLETED" &&
      batch.status !== "PACKAGED" &&
      batch.status !== "DELIVERED"
    ) {
      const assignedWorkers = await this.buildWorkerSummaries(batch);
      return {
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        productName: batch.productSnapshot?.productName || "Product",
        variantName: batch.productSnapshot?.variantName || "Variant",
        costType: "ACTUAL",
        status: "NOT_READY",
        productionStatus: batch.status,
        plannedQuantity: batch.plannedQuantity,
        usableQuantity: batch.usableQuantity ?? null,
        producedQuantity: batch.producedQuantity ?? null,
        wastageQuantity: batch.wastageQuantity ?? 0,
        unit: batch.unit,
        assignedWorkers,
        consumedIngredients: batch.consumedIngredients || [],
        materialSnapshots: [],
        ingredientCost: 0,
        labourCost: 0,
        packagingCost: 0,
        electricityCost: 0,
        electricitySnapshot: null,
        packagingSnapshots: [],
        packagingBasis: "PIECE_BASED",
        expenses: [],
        totalCost: 0,
        costPerUsableItem: null,
        wastageCost: 0,
        estimatedDurationMinutes: batch.estimatedDurationMinutes || batch.recipeSnapshot?.estimatedDurationMinutes || null,
        equipmentRuntimeMinutes: batch.equipmentRuntimeMinutes || null,
        delayReason: batch.delayReason || "",
        actualStartTime: batch.actualStartTime,
        actualCompletionTime: batch.actualCompletionTime,
        incomplete: [
          `Production batch is currently in ${batch.status} status. Production must be completed before actual cost can be finalized.`,
          "Ingredients must be requisitioned and consumed during production before material costs are recorded.",
          "Actual worker hours and usable output yields will be recorded upon completion.",
        ],
      };
    }
    const draftPackagingCostPaise = batch.costing?.packagingCostPaise;
    const draftExpenses = batch.costing?.expenses || [];
    const preview = await this.actualComponents(batch, {
      packagingCostPaise: draftPackagingCostPaise,
      expenses: draftExpenses,
    });
    const assignedWorkers = await this.buildWorkerSummaries(batch);
    return {
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      productName: batch.productSnapshot?.productName || "Product",
      variantName: batch.productSnapshot?.variantName || "Variant",
      costType: "ACTUAL",
      usableQuantity: batch.usableQuantity,
      producedQuantity: batch.producedQuantity,
      wastageQuantity: batch.wastageQuantity,
      estimatedDurationMinutes: batch.estimatedDurationMinutes || batch.recipeSnapshot?.estimatedDurationMinutes || null,
      equipmentRuntimeMinutes: batch.equipmentRuntimeMinutes || preview.electricitySnapshot?.runtimeMinutes || null,
      delayReason: batch.delayReason || "",
      actualStartTime: batch.actualStartTime,
      actualCompletionTime: batch.actualCompletionTime,
      assignedWorkers,
      consumedIngredients: batch.consumedIngredients || [],
      ...this.presentComponents(preview),
      incomplete: preview.incomplete,
    };
  }
  async presentSnapshot(batch) {
    const cost = batch.costing.toObject
      ? batch.costing.toObject()
      : batch.costing;
    const assignedWorkers = await this.buildWorkerSummaries(batch);
    const finishedQuantity = Number.isFinite(batch.usableQuantity) && batch.usableQuantity !== null
      ? batch.usableQuantity
      : (Number.isFinite(batch.packagedQuantity) && batch.packagedQuantity !== null
        ? batch.packagedQuantity
        : (Number.isFinite(batch.producedQuantity) && batch.producedQuantity !== null
          ? batch.producedQuantity
          : (Number.isFinite(batch.plannedQuantity) ? batch.plannedQuantity : 0)));
    return {
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      productName: batch.productSnapshot?.productName || "Product",
      variantName: batch.productSnapshot?.variantName || "Variant",
      assignedWorkers,
      status: cost.status,
      actualFinishedQuantity: finishedQuantity,
      ingredientCost: amount(cost.ingredientCostPaise || 0),
      labourCost: amount(cost.labourCostPaise || 0),
      packagingCost: amount(cost.packagingCostPaise || 0),
      electricityCost: amount(cost.electricityCostPaise || 0),
      electricityCostPerUnit: batch.productSnapshot?.electricityCostPerUnit ?? cost.electricitySnapshot?.costPerUnit ?? 0,
      packagingCostPerUnit: batch.productSnapshot?.packagingCostPerUnit ?? cost.packagingSnapshots?.[0]?.costPerUnit ?? 0,
      electricitySnapshot: cost.electricitySnapshot || null,
      packagingSnapshots: cost.packagingSnapshots || [],
      packagingBasis: cost.packagingBasis || "PRODUCT_CONFIGURED",
      otherExpense: amount(cost.otherExpensePaise || 0),
      wastageCost: amount(cost.wastageCostPaise || 0),
      totalCost: amount(cost.totalCostPaise || 0),
      costPerUsableItem:
        cost.costPerUsableItemPaise === null
          ? null
          : amount(cost.costPerUsableItemPaise),
      costPerUnit:
        cost.costPerUsableItemPaise === null
          ? null
          : amount(cost.costPerUsableItemPaise),
      costPerUsableItemStatus: cost.costPerUsableItemStatus || (cost.costPerUsableItemPaise !== null ? "COMPUTABLE" : "UNAVAILABLE"),
      costPerUnitStatus: cost.costPerUsableItemStatus || (cost.costPerUsableItemPaise !== null ? "COMPUTABLE" : "UNAVAILABLE"),
      usableQuantity: batch.usableQuantity,
      producedQuantity: batch.producedQuantity,
      plannedQuantity: batch.plannedQuantity,
      wastageQuantity: batch.wastageQuantity,
      estimatedDurationMinutes: batch.estimatedDurationMinutes || batch.recipeSnapshot?.estimatedDurationMinutes || null,
      equipmentRuntimeMinutes: batch.equipmentRuntimeMinutes || cost.electricitySnapshot?.runtimeMinutes || null,
      delayReason: batch.delayReason || "",
      actualStartTime: batch.actualStartTime,
      actualCompletionTime: batch.actualCompletionTime,
      wastagePercentage:
        batch.producedQuantity > 0
          ? Number(
              ((batch.wastageQuantity / batch.producedQuantity) * 100).toFixed(
                2,
              ),
            )
          : null,
      expenses: cost.expenses || [],
      calculatedAt: cost.calculatedAt,
      finalizedAt: cost.finalizedAt,
      finalizedBy: cost.finalizedBy,
      materialSnapshots: cost.materialSnapshots || [],
      labourSnapshots: cost.labourSnapshots || [],
    };
  }
  presentComponents(c) {
    return {
      status: c.incomplete.length ? "INCOMPLETE" : "READY_TO_FINALIZE",
      actualFinishedQuantity: c.actualFinishedQuantity,
      ingredientCost: amount(c.ingredientCostPaise),
      labourCost: amount(c.labourCostPaise),
      packagingCost: amount(c.packagingCostPaise),
      electricityCost: amount(c.electricityCostPaise || 0),
      electricityCostPerUnit: c.electricityCostPerUnit,
      packagingCostPerUnit: c.packagingCostPerUnit,
      electricitySnapshot: c.electricitySnapshot || null,
      packagingSnapshots: c.packagingSnapshots || [],
      packagingBasis: c.packagingBasis || "PRODUCT_CONFIGURED",
      otherExpense: amount(c.otherExpensePaise),
      wastageCost: amount(c.wastageCostPaise),
      totalCost: amount(c.totalCostPaise),
      costPerUsableItem:
        c.costPerUsableItemPaise === null
          ? null
          : amount(c.costPerUsableItemPaise),
      costPerUnit:
        c.costPerUsableItemPaise === null
          ? null
          : amount(c.costPerUsableItemPaise),
      costPerUsableItemStatus: c.costPerUsableItemStatus,
      costPerUnitStatus: c.costPerUsableItemStatus,
      wastagePercentage: c.wastagePercentage,
      materialSnapshots: c.materialSnapshots,
      labourSnapshots: c.labourSnapshots,
      expenses: c.expenses,
    };
  }
  async finalize(id, input, user) {
    assertId(id, "batch ID");
    const claim = await ProductionBatch.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ["QUALITY_FAILED", "PACKAGED", "COMPLETED", "DELIVERED"] },
        "costing.status": "NOT_FINALIZED",
        $or: [
          { wastageWriteCount: 0 },
          { wastageWriteCount: { $exists: false } },
        ],
      },
      { $set: { "costing.status": "FINALIZING" } },
      { new: true },
    );
    if (!claim) {
      const batch = await ProductionBatch.findById(id);
      if (!batch) throw AppError.notFound("Production batch not found");
      throw AppError.conflict(
        batch.costing.status === "FINALIZED"
          ? "Production cost is already finalized"
          : "Batch is not ready for cost finalization",
      );
    }
    try {
      const expenses = (input.expenses || []).map((item) => ({
        description: item.description,
        amountPaise: rupeesToPaise(item.amount),
        notes: item.notes || "",
        recordedBy: user._id,
        recordedAt: new Date(),
      }));
      const calculated = await this.actualComponents(claim, {
        packagingCostPaise: input.packagingCost !== undefined && input.packagingCost !== null ? rupeesToPaise(input.packagingCost) : undefined,
        expenses,
        recordedBy: user._id,
      });
      if (calculated.incomplete.length)
        throw AppError.conflict(
          `Cannot finalize production cost: ${calculated.incomplete.join("; ")}`,
        );
      const finalizedAt = new Date();
      const update = {
        "costing.status": "FINALIZED",
        "costing.ingredientCostPaise": calculated.ingredientCostPaise,
        "costing.labourCostPaise": calculated.labourCostPaise,
        "costing.packagingCostPaise": calculated.packagingCostPaise,
        "costing.electricityCostPaise": calculated.electricityCostPaise,
        "costing.electricitySnapshot": calculated.electricitySnapshot,
        "costing.packagingSnapshots": calculated.packagingSnapshots,
        "costing.packagingBasis": calculated.packagingBasis,
        "costing.otherExpensePaise": calculated.otherExpensePaise,
        "costing.wastageCostPaise": calculated.wastageCostPaise,
        "costing.totalCostPaise": calculated.totalCostPaise,
        "costing.costPerUsableItemPaise": calculated.costPerUsableItemPaise,
        "costing.costPerUsableItemStatus": calculated.costPerUsableItemStatus,
        "costing.materialSnapshots": calculated.materialSnapshots,
        "costing.labourSnapshots": calculated.labourSnapshots,
        "costing.expenses": calculated.expenses,
        "costing.calculatedAt": finalizedAt,
        "costing.finalizedAt": finalizedAt,
        "costing.finalizedBy": user._id,
      };
      const batch = await ProductionBatch.findOneAndUpdate(
        { _id: id, "costing.status": "FINALIZING" },
        { $set: update },
        { new: true },
      );
      if (!batch) throw AppError.conflict("Cost finalization claim was lost");
      await WastageRecord.updateMany(
        {
          productionBatch: batch._id,
          type: "PRODUCTION_OUTPUT",
          status: "RECORDED",
        },
        {
          $set: {
            valuePaise: calculated.outputWastePaise,
            valueBasis:
              calculated.outputWastePaise > 0
                ? "PRODUCTION_COST"
                : "NOT_VALUED",
          },
        },
      );
      return {
        batchNumber: batch.batchNumber,
        costType: "ACTUAL",
        ...(await this.presentSnapshot(batch)),
      };
    } catch (error) {
      await ProductionBatch.updateOne(
        { _id: id, "costing.status": "FINALIZING" },
        { $set: { "costing.status": "NOT_FINALIZED" } },
      );
      throw error;
    }
  }
  async autoFinalizeIfReady(id, user) {
    if (!id) return null;
    try {
      const batch = await ProductionBatch.findById(id);
      if (!batch) return null;
      if (batch.costing?.status === "FINALIZED" || batch.costing?.status === "FINALIZING") {
        return batch;
      }
      if (!["PACKAGING", "PACKAGED", "COMPLETED", "DELIVERED"].includes(batch.status)) {
        return batch;
      }
      if (batch.wastageWriteCount > 0) {
        return batch;
      }

      let packagingCostPaise = batch.costing?.packagingCostPaise;
      let expenses = Array.isArray(batch.costing?.expenses) ? [...batch.costing.expenses] : [];

      const calculated = await this.actualComponents(batch, {
        packagingCostPaise,
        expenses,
        recordedBy: user?._id || batch.createdBy,
      });

      if (calculated.incomplete && calculated.incomplete.length > 0) {
        return batch;
      }

      const claim = await ProductionBatch.findOneAndUpdate(
        {
          _id: id,
          "costing.status": "NOT_FINALIZED",
          status: { $in: ["PACKAGING", "PACKAGED", "COMPLETED", "DELIVERED"] },
        },
        { $set: { "costing.status": "FINALIZING" } },
        { new: true },
      );
      if (!claim) return batch;

      const finalizedAt = new Date();
      const update = {
        "costing.status": "FINALIZED",
        "costing.ingredientCostPaise": calculated.ingredientCostPaise,
        "costing.labourCostPaise": calculated.labourCostPaise,
        "costing.packagingCostPaise": calculated.packagingCostPaise,
        "costing.electricityCostPaise": calculated.electricityCostPaise,
        "costing.electricitySnapshot": calculated.electricitySnapshot,
        "costing.packagingSnapshots": calculated.packagingSnapshots,
        "costing.packagingBasis": calculated.packagingBasis,
        "costing.otherExpensePaise": calculated.otherExpensePaise,
        "costing.wastageCostPaise": calculated.wastageCostPaise,
        "costing.totalCostPaise": calculated.totalCostPaise,
        "costing.costPerUsableItemPaise": calculated.costPerUsableItemPaise,
        "costing.costPerUsableItemStatus": calculated.costPerUsableItemStatus,
        "costing.materialSnapshots": calculated.materialSnapshots,
        "costing.labourSnapshots": calculated.labourSnapshots,
        "costing.expenses": calculated.expenses,
        "costing.calculatedAt": finalizedAt,
        "costing.finalizedAt": finalizedAt,
        "costing.finalizedBy": user?._id || batch.createdBy,
      };

      if (Array.isArray(calculated.labourSnapshots) && calculated.labourSnapshots.length > 0) {
        const workerHourMap = new Map(calculated.labourSnapshots.map((ls) => [String(ls.worker), ls.actualHours]));
        update.assignedWorkers = batch.assignedWorkers.map((aw) => {
          const obj = aw.toObject ? aw.toObject() : { ...aw };
          if (obj.actualHours === null || obj.actualHours === undefined) {
            obj.actualHours = workerHourMap.get(String(obj.worker)) ?? obj.actualHours;
          }
          return obj;
        });
      }

      const updated = await ProductionBatch.findOneAndUpdate(
        { _id: id, "costing.status": "FINALIZING" },
        { $set: update },
        { new: true },
      );

      if (updated) {
        await WastageRecord.updateMany(
          {
            productionBatch: updated._id,
            type: "PRODUCTION_OUTPUT",
            status: "RECORDED",
          },
          {
            $set: {
              valuePaise: calculated.outputWastePaise,
              valueBasis:
                calculated.outputWastePaise > 0
                  ? "PRODUCTION_COST"
                  : "NOT_VALUED",
            },
          },
        );
        return updated;
      }
      return batch;
    } catch {
      await ProductionBatch.updateOne(
        { _id: id, "costing.status": "FINALIZING" },
        { $set: { "costing.status": "NOT_FINALIZED" } },
      );
      return null;
    }
  }
  async saveDraft(id, input = {}, user) {
    assertId(id, "batch ID");
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");
    if (batch.costing?.status === "FINALIZED") {
      throw AppError.conflict("Cannot edit draft cost on a finalized batch");
    }

    if (!batch.costing) {
      batch.costing = { status: "NOT_FINALIZED" };
    }

    if (input.packagingCost !== undefined) {
      batch.costing.packagingCostPaise = rupeesToPaise(input.packagingCost);
    }
    if (Array.isArray(input.expenses)) {
      batch.costing.expenses = input.expenses.map((item) => ({
        description: item.description?.trim() || "",
        amountPaise: rupeesToPaise(item.amount || 0),
        notes: item.notes?.trim() || "",
        recordedBy: user._id,
        recordedAt: new Date(),
      }));
    }

    await batch.save();
    return this.getBatchCost(id);
  }
  async estimate(input, priceChanges = []) {
    const product = await Product.findOne({
      _id: input.product,
      isActive: true,
      isAvailable: true,
    });
    const variant = product?.variants.id(input.productVariant);
    if (!product || !variant || !variant.isActive || !variant.isAvailable)
      throw AppError.badRequest("Active product variant not found");
    const recipe = await Recipe.findOne({
      product: product._id,
      variant: variant._id,
      isActive: true,
    }).populate("ingredients.ingredient", "name unit isActive");
    if (!recipe) throw AppError.badRequest("Active recipe not found");
    const recipeBatchQuantity = input.plannedQuantity / recipe.expectedYield;
    if (!Number.isInteger(recipeBatchQuantity))
      throw AppError.badRequest(
        "Planned quantity must be a whole multiple of the recipe expected yield",
      );
    const changes = new Map(
      priceChanges.map((entry) => [
        String(entry.ingredient),
        entry.increasePercent,
      ]),
    );
    const recipeIngredientIds = new Set(
      recipe.ingredients.map((line) => String(line.ingredient?._id)),
    );
    if ([...changes.keys()].some((id) => !recipeIngredientIds.has(id)))
      throw AppError.badRequest(
        "Every simulated price change must reference an ingredient in this recipe",
      );
    const ingredientCosts = [];
    for (const line of recipe.ingredients) {
      const ingredient = line.ingredient;
      if (
        !ingredient?.isActive ||
        !areUnitsConvertible(line.unit, ingredient.unit)
      )
        throw AppError.badRequest(
          "Recipe contains an inactive ingredient or incompatible unit",
        );
      const needed = convertQuantity(
        line.quantity * recipeBatchQuantity,
        line.unit,
        ingredient.unit,
      );
      const stock = await inventoryService.getCurrentStock(ingredient._id);
      const availableForEstimation = Math.max(
        0,
        stock.currentStock -
          (ingredient.reservedStock || 0) -
          (ingredient.productionReservedStock || 0) -
          ingredient.minimumStock,
      );
      if (availableForEstimation + 0.000001 < needed)
        throw AppError.conflict(
          `Insufficient unreserved inventory to estimate ${ingredient.name}`,
        );
      const lots = await InventoryLot.find({
        ingredient: ingredient._id,
        status: "AVAILABLE",
        remainingQuantity: { $gt: 0 },
        ...nowAvailable(),
      }).sort({ expiryDate: 1, createdAt: 1 });
      let remaining = needed;
      let cost = 0;
      for (const lot of lots) {
        if (!areUnitsConvertible(lot.unit, ingredient.unit))
          throw AppError.conflict(
            `Inventory unit mismatch for ${ingredient.name}`,
          );
        const available = convertQuantity(
          lot.remainingQuantity,
          lot.unit,
          ingredient.unit,
        );
        const use = Math.min(available, remaining);
        const costPerUnit =
          lot.unitCost *
          (changes.has(String(ingredient._id))
            ? 1 + changes.get(String(ingredient._id)) / 100
            : 1);
        cost = sumSafePaise([
          cost,
          multiplyQuantityByRupees(
            convertQuantity(use, ingredient.unit, lot.unit),
            costPerUnit,
          ),
        ]);
        remaining = Number((remaining - use).toFixed(6));
        if (remaining <= 0.000001) break;
      }
      if (remaining > 0.000001)
        throw AppError.conflict(
          `Insufficient inventory to estimate ${ingredient.name}`,
        );
      ingredientCosts.push({
        ingredient: ingredient._id,
        name: ingredient.name,
        quantity: needed,
        unit: ingredient.unit,
        estimatedCost: amount(cost),
      });
    }
    const ingredientCostPaise = sumSafePaise(
      ingredientCosts.map((line) => rupeesToPaise(line.estimatedCost)),
    );
    const labourCostPaise = input.labour?.length
      ? await this.estimateLabour(input.labour)
      : 0;
    const packagingCostPaise = rupeesToPaise(input.packagingCost ?? 0);
    const total = sumSafePaise([
      ingredientCostPaise,
      labourCostPaise,
      packagingCostPaise,
    ]);
    return {
      costType: "ESTIMATED",
      product: product.name,
      variant: variant.name,
      plannedQuantity: input.plannedQuantity,
      recipeRevision: recipe.revision,
      recipeBatchQuantity,
      ingredientCosts,
      ingredientCost: amount(ingredientCostPaise),
      labourCost: amount(labourCostPaise),
      packagingCost: amount(packagingCostPaise),
      otherExpense: 0,
      totalCost: amount(total),
      costPerItem:
        input.plannedQuantity > 0
          ? amount(Math.round(total / input.plannedQuantity))
          : null,
    };
  }
  async estimateLabour(labour) {
    let total = 0;
    for (const line of labour) {
      const worker = await User.findOne({
        _id: line.worker,
        role: "PRODUCTION_STAFF",
        isActive: true,
      });
      if (
        !worker ||
        worker.hourlyLabourRate === null ||
        worker.hourlyLabourRate === undefined ||
        !Number.isFinite(worker.hourlyLabourRate)
      )
        throw AppError.badRequest(
          "Estimated labour requires active workers with configured hourly rates",
        );
      total = sumSafePaise([
        total,
        multiplyQuantityByRupees(line.hours, worker.hourlyLabourRate),
      ]);
    }
    return total;
  }
  async priceImpact(input) {
    const base = await this.estimate(input, []);
    const simulated = await this.estimate(input, input.changes);
    return {
      simulationType: "ESTIMATE",
      baseEstimatedCost: base.totalCost,
      simulatedEstimatedCost: simulated.totalCost,
      delta: amount(
        rupeesToPaise(simulated.totalCost) - rupeesToPaise(base.totalCost),
      ),
      changes: input.changes,
    };
  }
  async revenueForOrder(order, productId = null, variantId = null) {
    if (
      ["CANCELLED", "EXPIRED"].includes(order.status) ||
      order.paymentSummary?.status !== "CAPTURED"
    )
      return 0;
    const payment = await Payment.exists({
      order: order._id,
      status: "CAPTURED",
    });
    if (!payment) return 0;
    return sumSafePaise(
      order.items
        .filter(
          (line) =>
            (!productId || String(line.productId) === String(productId)) &&
            (!variantId || String(line.variantId) === String(variantId)),
        )
        .map((line) => rupeesToPaise(line.lineTotal)),
    );
  }
  async orderProfitability(id) {
    assertId(id, "order ID");
    const order = await Order.findById(id);
    if (!order) throw AppError.notFound("Order not found");
    const revenue = await this.revenueForOrder(order);
    const batches = await ProductionBatch.find({
      relatedOrders: order._id,
      "costing.status": "FINALIZED",
    });
    let cost = 0;
    for (const batch of batches) {
      const linkedOrders = await Order.find({
        _id: { $in: batch.relatedOrders },
      });
      const matchingQuantity = linkedOrders.reduce(
        (total, linked) =>
          total +
          linked.items
            .filter(
              (line) =>
                String(line.productId) === String(batch.product) &&
                String(line.variantId) === String(batch.productVariant),
            )
            .reduce((sum, line) => sum + line.quantity, 0),
        0,
      );
      const currentOrderQuantity = order.items
        .filter(
          (line) =>
            String(line.productId) === String(batch.product) &&
            String(line.variantId) === String(batch.productVariant),
        )
        .reduce((sum, line) => sum + line.quantity, 0);
      if (matchingQuantity > 0 && currentOrderQuantity > 0)
        cost = sumSafePaise([
          cost,
          Math.round(
            (batch.costing.totalCostPaise * currentOrderQuantity) /
              matchingQuantity,
          ),
        ]);
    }
    return {
      orderNumber: order.orderNumber,
      ...summaryMath(revenue, cost),
      unitsSold: revenue
        ? order.items.reduce((n, line) => n + line.quantity, 0)
        : 0,
      unitsProduced: batches.reduce(
        (sum, batch) => sum + batch.producedQuantity,
        0,
      ),
      unitsWasted: batches.reduce(
        (sum, batch) => sum + batch.wastageQuantity,
        0,
      ),
      batchNumbers: batches.map((batch) => batch.batchNumber),
    };
  }
  async batchProfitability(id) {
    assertId(id, "batch ID");
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");
    if (batch.costing.status !== "FINALIZED")
      throw AppError.conflict(
        "Batch cost must be finalized before profitability is available",
      );
    const orders = await Order.find({ _id: { $in: batch.relatedOrders } });
    let revenue = 0;
    const linkedBatches = await ProductionBatch.find({
      relatedOrders: { $in: batch.relatedOrders },
      product: batch.product,
      productVariant: batch.productVariant,
      "costing.status": "FINALIZED",
    });
    for (const order of orders) {
      const orderRevenue = await this.revenueForOrder(
        order,
        batch.product,
        batch.productVariant,
      );
      const totalProducedForOrder = linkedBatches
        .filter((item) =>
          item.relatedOrders.some(
            (orderId) => String(orderId) === String(order._id),
          ),
        )
        .reduce((sum, item) => sum + item.usableQuantity, 0);
      if (totalProducedForOrder > 0)
        revenue = sumSafePaise([
          revenue,
          Math.round(
            (orderRevenue * batch.usableQuantity) / totalProducedForOrder,
          ),
        ]);
    }
    return {
      batchNumber: batch.batchNumber,
      ...summaryMath(revenue, batch.costing.totalCostPaise),
      unitsSold: revenue ? batch.usableQuantity : 0,
      unitsProduced: batch.producedQuantity,
      unitsWasted: batch.wastageQuantity,
    };
  }
  async productProfitability(productId, variantId = null) {
    assertId(productId, "product ID");
    if (variantId) assertId(variantId, "variant ID");
    const filter = {
      "items.productId": productId,
      "paymentSummary.status": "CAPTURED",
      status: { $nin: ["CANCELLED", "EXPIRED"] },
    };
    const orders = await Order.find(filter);
    const orderIds = orders.map((order) => order._id);
    const payments = await Payment.find({
      order: { $in: orderIds },
      status: "CAPTURED",
    }).select("order");
    const paidOrderIds = new Set(
      payments.map((payment) => String(payment.order)),
    );
    let revenue = 0;
    let unitsSold = 0;
    for (const order of orders)
      if (paidOrderIds.has(String(order._id)))
        for (const line of order.items) {
          if (
            String(line.productId) === String(productId) &&
            (!variantId || String(line.variantId) === String(variantId))
          ) {
            revenue = sumSafePaise([revenue, rupeesToPaise(line.lineTotal)]);
            unitsSold += line.quantity;
          }
        }
    const batchFilter = {
      product: productId,
      "costing.status": "FINALIZED",
      ...(variantId ? { productVariant: variantId } : {}),
    };
    const batches = await ProductionBatch.find(batchFilter).sort({
      actualCompletionTime: 1,
    });
    let remainingSold = unitsSold;
    let productionCost = 0;
    for (const batch of batches) {
      if (remainingSold <= 0 || batch.usableQuantity <= 0) continue;
      const assignedUnits = Math.min(batch.usableQuantity, remainingSold);
      const perItemPaise =
        batch.costing.costPerUsableItemPaise ??
        Math.round(batch.costing.totalCostPaise / batch.usableQuantity);
      productionCost = sumSafePaise([
        productionCost,
        perItemPaise * assignedUnits,
      ]);
      remainingSold -= assignedUnits;
    }
    return {
      ...(variantId ? { variantId } : { productId }),
      ...summaryMath(revenue, productionCost),
      unitsSold,
      unitsProduced: batches.reduce(
        (sum, batch) => sum + batch.producedQuantity,
        0,
      ),
      unitsWasted: batches.reduce(
        (sum, batch) => sum + batch.wastageQuantity,
        0,
      ),
    };
  }
  async variantProfitabilityById(variantId) {
    assertId(variantId, "variant ID");
    const product = await Product.findOne({ "variants._id": variantId });
    if (!product) throw AppError.notFound("Product variant not found");
    return this.productProfitability(product._id, variantId);
  }
  async summary({ from, to }) {
    const filter = {
      status: "FINALIZED",
      ...(from || to
        ? {
            finalizedAt: {
              ...(from ? { $gte: from } : {}),
              ...(to ? { $lte: to } : {}),
            },
          }
        : {}),
    };
    const batches = await ProductionBatch.find({
      "costing.status": "FINALIZED",
      ...(filter.finalizedAt
        ? { "costing.finalizedAt": filter.finalizedAt }
        : {}),
    });
    const totals = batches.reduce(
      (sum, batch) => ({
        ingredient: sumSafePaise([
          sum.ingredient,
          batch.costing.ingredientCostPaise,
        ]),
        labour: sumSafePaise([sum.labour, batch.costing.labourCostPaise]),
        packaging: sumSafePaise([
          sum.packaging,
          batch.costing.packagingCostPaise,
        ]),
        other: sumSafePaise([sum.other, batch.costing.otherExpensePaise]),
        total: sumSafePaise([sum.total, batch.costing.totalCostPaise]),
      }),
      { ingredient: 0, labour: 0, packaging: 0, other: 0, total: 0 },
    );
    return {
      batchCount: batches.length,
      ingredientCost: amount(totals.ingredient),
      labourCost: amount(totals.labour),
      packagingCost: amount(totals.packaging),
      otherExpense: amount(totals.other),
      wastageCost: amount(
        sumSafePaise(batches.map((batch) => batch.costing.wastageCostPaise)),
      ),
      totalCost: amount(totals.total),
    };
  }
}

export const costingService = new CostingService();
export default costingService;
