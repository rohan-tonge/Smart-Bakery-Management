import { z } from "zod";
import { UNITS } from "../utils/constants.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const recipeFields = {
  ingredients: z
    .array(
      z.object({
        ingredient: objectId,
        quantity: z.number().positive(),
        unit: z.enum(Object.values(UNITS)),
      }),
    )
    .min(1, "A recipe must include at least one ingredient")
    .optional(),
  expectedYield: z.number().positive().optional(),
  yieldUnit: z.enum(Object.values(UNITS)).optional(),
  preparationTime: z.number().finite("Preparation time must be a finite number").min(0, "Preparation time cannot be negative").optional(),
  productionTime: z.number().finite("Production time must be a finite number").min(0, "Production time cannot be negative").optional(),
  totalTimeMinutes: z.number().finite("Total time must be a finite number").positive("Total time must be greater than 0").optional(),
  totalTime: z.number().finite("Total time must be a finite number").positive("Total time must be greater than 0").optional(),
  duration: z.number().finite("Duration must be a finite number").positive("Duration must be greater than 0").optional(),
  estimatedDurationMinutes: z.number().finite("Estimated duration must be a finite number").positive("Estimated duration must be positive").max(10000).optional(),
  equipmentPowerKw: z.number().finite("Equipment power must be a finite number").min(0, "Equipment power cannot be negative").max(1000).optional(),
  electricityTariff: z.number().finite("Electricity tariff must be a finite number").min(0, "Electricity tariff cannot be negative").max(10000).optional(),
  labourMinutes: z.number().finite("Labour minutes must be a finite number").min(0).optional(),
  powerMinutes: z.number().finite("Power minutes must be a finite number").min(0).optional(),
  labourCostPerMinute: z.number().finite("Labour cost per minute must be a finite number").min(0).optional(),
  powerCostPerMinute: z.number().finite("Power cost per minute must be a finite number").min(0).optional(),
  packagingCostPerUnit: z.number().finite("Packaging cost per unit must be a finite number").min(0).optional(),
  packagingQuantity: z.number().finite("Packaging quantity must be a finite number").min(0).optional(),
  packagingMaterials: z.array(z.object({
    name: z.string().trim().min(1, "Packaging material name is required").max(100),
    costPerUnit: z.number().finite("Cost per unit must be a finite number").min(0, "Cost per unit cannot be negative"),
    consumptionType: z.enum(["PER_PIECE", "PER_BATCH"]).optional(),
    unitsPerItem: z.number().finite().positive().optional(),
  })).optional(),
  instructions: z.string().trim().max(12000).optional(),
  isActive: z.boolean().optional(),
};

export const createRecipeSchema = z
  .object({
    ...recipeFields,
    ingredients: recipeFields.ingredients.unwrap(),
  })
  .refine(
    (data) => {
      const prod = data.totalTimeMinutes !== undefined
        ? data.totalTimeMinutes
        : (data.totalTime !== undefined
          ? data.totalTime
          : (data.productionTime !== undefined ? data.productionTime : data.duration));
      const prep = data.preparationTime !== undefined ? data.preparationTime : 0;
      if (prod === undefined && data.preparationTime === undefined) {
        return false;
      }
      const total = prep + (prod !== undefined ? prod : 0);
      return Number.isFinite(total) && total > 0;
    },
    {
      message: "Recipe must define a positive preparation or production duration in minutes",
      path: ["productionTime"],
    },
  );

export const updateRecipeSchema = z
  .object(recipeFields)
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  )
  .refine(
    (data) => {
      if (data.productionTime !== undefined && (!Number.isFinite(data.productionTime) || data.productionTime < 0)) {
        return false;
      }
      if (data.preparationTime !== undefined && (!Number.isFinite(data.preparationTime) || data.preparationTime < 0)) {
        return false;
      }
      if (data.duration !== undefined && (!Number.isFinite(data.duration) || data.duration <= 0)) {
        return false;
      }
      if (
        data.productionTime !== undefined &&
        data.preparationTime !== undefined &&
        data.productionTime + data.preparationTime <= 0
      ) {
        return false;
      }
      if (data.productionTime === 0 && data.preparationTime === undefined && data.duration === undefined) {
        return false;
      }
      return true;
    },
    {
      message: "Recipe must define a positive preparation or production duration in minutes",
      path: ["productionTime"],
    },
  );
export const recipeParamsSchema = z.object({
  productId: objectId,
  variantId: objectId,
});
export const calculateRecipeSchema = z.object({
  productId: objectId,
  variantId: objectId,
  quantity: z.number().positive(),
});
