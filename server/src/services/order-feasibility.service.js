import mongoose from "mongoose";
import Product from "../models/product.model.js";
import Recipe from "../models/recipe.model.js";
import Ingredient from "../models/ingredient.model.js";
import Order from "../models/order.model.js";
import FinishedProductStock from "../models/finishedProductStock.model.js";
import productService from "./product.service.js";
import inventoryService from "./inventory.service.js";
import capacityService from "./capacity.service.js";
import AppError from "../utils/appError.js";

import {
  areUnitsConvertible,
  convertQuantity,
  roundQuantity,
} from "../utils/measurement.utils.js";

import { CUSTOMER_ORDER_STATUSES } from "../utils/constants.js";

const activeStatuses = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export const orderFeasibilityService = {
  async check(items, { detailed = false, excludeOrderId = null, existingOrder = null } = {}) {
    const itemResults = [];
    const requirements = new Map();

    let productsValid = true;
    let finishedAdequate = true;
    let productionRequired = false;
    let estimatedMinutes = 0;
    let estimatedRecipeBatches = 0;
    let maxTaskMinutes = 0;

    // ============================================================
    // 1. Check products, variants and finished stock
    // ============================================================
    for (const item of items) {
      const product = await Product.findById(item.productId);
      const variant = product?.variants.id(item.variantId);

      const valid = Boolean(
        product?.isActive &&
        product.isAvailable &&
        variant?.isActive &&
        variant.isAvailable,
      );

      if (!valid) {
        productsValid = false;

        itemResults.push({
          productId: item.productId,
          variantId: item.variantId,
          requestedQuantity: item.quantity,
          valid: false,
          issue: "PRODUCT_OR_VARIANT_UNAVAILABLE",
        });

        continue;
      }

      const stock = await FinishedProductStock.findOne({
        product: product._id,
        variant: variant._id,
      });

      const reserved = stock?.reservedQuantity || 0;

      const freeFinished = Math.max(0, (stock?.onHandQuantity || 0) - reserved);

      // reservedQuantity is the authoritative aggregate counter;
      // do not count order lines again.
      const finishedQuantity = Math.min(item.quantity, freeFinished);

      const toProduce = item.quantity - finishedQuantity;

      // ============================================================
      // 2. Production / recipe requirement
      // ============================================================
      if (toProduce > 0) {
        productionRequired = true;
        finishedAdequate = false;

        let recipe = await Recipe.findOne({
          product: product._id,
          variant: variant._id,
          isActive: true,
        });

        const productPrep = Number(product.preparationTime || 0);
        const productProd = Number(product.productionTime || 0);
        const productTotal = productPrep + productProd;

        // If no active recipe exists, but the product defines positive duration,
        // auto-ensure an active recipe for this variant!
        if (!recipe && productTotal > 0) {
          try {
            recipe = await productService.ensureVariantRecipe(product, variant);
          } catch {
            // ignore
          }
        }

        if (!recipe) {
          itemResults.push({
            productId: product._id,
            variantId: variant._id,
            productName: product.name,
            variantName: variant.name,
            requestedQuantity: item.quantity,
            finishedStock: finishedQuantity,
            productionRequired: toProduce,
            valid: false,
            issue: "ACTIVE_RECIPE_REQUIRED",
            message: `Product '${product.name}' (${variant.name}) requires made-to-order production but has no active recipe configured.`,
          });

          productsValid = false;
          continue;
        }

        const taskMinutes = Number((recipe.preparationTime || 0) + (recipe.productionTime || 0));

        const expectedYield = recipe?.expectedYield || 1;
        const batches = Math.ceil(toProduce / expectedYield);
        estimatedRecipeBatches += batches;

        if (!Number.isFinite(taskMinutes) || taskMinutes <= 0) {
          itemResults.push({
            productId: product._id,
            variantId: variant._id,
            productName: product.name,
            variantName: variant.name,
            requestedQuantity: item.quantity,
            finishedStock: finishedQuantity,
            productionRequired: toProduce,
            valid: false,
            issue: "RECIPE_DURATION_REQUIRED",
            message: `The product recipe for '${product.name}' (${variant.name}) must define a positive preparation or production duration before checkout.`,
          });

          productsValid = false;
        } else {
          estimatedMinutes += taskMinutes * batches;
          maxTaskMinutes = Math.max(maxTaskMinutes, taskMinutes);

          itemResults.push({
            productId: product._id,
            variantId: variant._id,
            productName: product.name,
            variantName: variant.name,
            requestedQuantity: item.quantity,
            finishedStock: finishedQuantity,
            productionRequired: toProduce,
            valid: true,
          });
        }

        // ========================================================
        // 3. Build combined ingredient requirements
        // ========================================================
        if (recipe?.ingredients?.length) {
          for (const line of recipe.ingredients) {
          const key = String(line.ingredient);

          const existing = requirements.get(key);

          if (existing && !areUnitsConvertible(line.unit, existing.unit)) {
            throw AppError.badRequest(
              `Incompatible recipe units for ingredient ${key}`,
            );
          }

          const quantity = line.quantity * batches;

          requirements.set(
            key,
            existing
              ? {
                  ...existing,
                  quantity:
                    existing.quantity +
                    convertQuantity(quantity, line.unit, existing.unit),
                }
              : {
                  ingredient: line.ingredient,
                  quantity,
                  unit: line.unit,
                },
          );
        }
        }
      } else {
        itemResults.push({
          productId: product._id,
          variantId: variant._id,
          productName: product.name,
          variantName: variant.name,
          requestedQuantity: item.quantity,
          finishedStock: finishedQuantity,
          productionRequired: toProduce,
          valid: true,
        });
      }
    }

    // ============================================================
    // 4. Check ingredient availability
    // ============================================================
    const ingredientRequirements = [];
    const shortages = [];

    for (const requirement of requirements.values()) {
      const ingredient = await Ingredient.findById(requirement.ingredient);

      if (!ingredient || !ingredient.isActive) {
        productsValid = false;
        continue;
      }

      if (!areUnitsConvertible(requirement.unit, ingredient.unit)) {
        throw AppError.badRequest(
          `Recipe unit ${requirement.unit} is incompatible with ingredient unit ${ingredient.unit}`,
        );
      }

      const required = convertQuantity(
        requirement.quantity,
        requirement.unit,
        ingredient.unit,
      );

      const { currentStock } = await inventoryService.getCurrentStock(
        ingredient._id,
      );

      // ==========================================================
      // Find active ingredient commitments from existing orders
      // ==========================================================
      const orderMatch = {
        status: {
          $in: activeStatuses,
        },
        $or: [
          {
            status: {
              $ne: CUSTOMER_ORDER_STATUSES.PENDING_PAYMENT,
            },
          },
          {
            reservationExpiresAt: {
              $gt: new Date(),
            },
          },
        ],
      };
      if (excludeOrderId) {
        orderMatch._id = { $ne: new mongoose.Types.ObjectId(excludeOrderId) };
      }
      const open = await Order.aggregate([
        {
          $match: orderMatch,
        },
        {
          $unwind: "$ingredientCommitments",
        },
        {
          $match: {
            "ingredientCommitments.ingredient": ingredient._id,
          },
        },
        {
          $group: {
            _id: null,
            quantity: {
              $sum: "$ingredientCommitments.quantity",
            },
          },
        },
      ]);

      const activeCommitments = open[0]?.quantity || 0;

      // When evaluating an existing order, account for its own reservation
      const thisOrderCommitment = existingOrder?.ingredientCommitments?.find(
        (c) => String(c.ingredient) === String(ingredient._id),
      );
      const thisOrderReserved = thisOrderCommitment?.quantity || 0;
      const otherReservations = Math.max(0, (ingredient.reservedStock || 0) - thisOrderReserved);
      const reservedToDeduct = Math.max(activeCommitments, otherReservations);

      // ==========================================================
      // IMPORTANT:
      // Keep minimum stock protected and round arithmetic
      // to avoid floating-point precision errors.
      // ==========================================================
      const available = Math.max(
        0,
        roundQuantity(
          currentStock -
            ingredient.minimumStock -
            reservedToDeduct,
        ),
      );

      const shortage = Math.max(0, roundQuantity(required - available));

      const row = {
        ingredientId: ingredient._id,
        ingredientName: ingredient.name,
        required,
        available,
        shortage,
        unit: ingredient.unit,
      };

      ingredientRequirements.push(row);

      if (shortage > 0) {
        shortages.push(row);
      }
    }

    // ============================================================
    // 5. Production capacity
    // ============================================================
    const capacity = await capacityService.assess({
      productionRequired,
      estimatedMinutes,
      maxTaskMinutes,
    });

    // ============================================================
    // 6. Overall feasibility
    // ============================================================
    const capacityReady = !productionRequired || ["AVAILABLE", "SUFFICIENT"].includes(capacity.status);
    const feasible = productsValid && shortages.length === 0 && capacityReady;

    const result = {
      feasible,

      items: itemResults,

      production: {
        required: productionRequired,
        estimatedRecipeBatches: Number(estimatedRecipeBatches.toFixed(6)),
      },

      ingredientRequirements: detailed ? ingredientRequirements : undefined,

      shortages: detailed
        ? shortages
        : shortages.map(({ ingredientId, shortage, unit }) => ({
            ingredientId,
            shortage,
            unit,
          })),

      checks: {
        products: productsValid,
        finishedStock: finishedAdequate,
        ingredients: shortages.length === 0,
        capacity: capacity.status,
        capacityReady,
        capacityReason: capacity.reason || "",
      },
      capacity,

      estimatedReadyAt: capacity.estimatedReadyAt,
    };

    // ============================================================
    // 7. Remove detailed ingredient requirements when
    //    detailed=false
    // ============================================================
    if (!detailed) {
      delete result.ingredientRequirements;
    }

    return result;
  },

  async checkOrder(orderId, { detailed = true } = {}) {
    const order = await Order.findById(orderId);
    if (!order) throw AppError.notFound("Order not found");

    const items = (order.items || []).map((x) => ({
      productId: x.productId?._id || x.productId || x.product,
      variantId: x.variantId || x.variant,
      quantity: x.quantity,
    }));

    const feasibility = await this.check(items, {
      detailed: true,
      excludeOrderId: order._id,
      existingOrder: order,
    });

    const isAvailable = feasibility.feasible && (!feasibility.shortages || feasibility.shortages.length === 0);

    return {
      orderId: order._id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      status: isAvailable ? "AVAILABLE" : "INSUFFICIENT",
      feasible: isAvailable,
      message: isAvailable
        ? "All required ingredients and inventory are available for this order."
        : "Inventory Warning: Insufficient Ingredients to fulfill this order.",
      shortages: feasibility.shortages || [],
      requirements: feasibility.ingredientRequirements || [],
      items: feasibility.items || [],
      checks: feasibility.checks,
      production: feasibility.production,
    };
  },
};

export default orderFeasibilityService;
