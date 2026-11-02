import productService from "../services/product.service.js";
import Recipe from "../models/recipe.model.js";
import recipeCostingService from "../services/recipeCosting.service.js";
import AppError from "../utils/appError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { USER_ROLES } from "../utils/constants.js";
import customerEngagementService from "../services/customer-engagement.service.js";

export const createProduct = asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Product created successfully", data: { product: await productService.create(req.body) } }));
export const listProducts = asyncHandler(async (req, res) => {
  const result = await productService.list({ user: req.user, ...req.query });
  return ApiResponse.success(res, { message: "Products retrieved successfully", data: { products: result.products }, meta: result.meta });
});
export const getProduct = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Product retrieved successfully", data: { product: await productService.getById(req.params.productId, req.user) } }));
export const updateProduct = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Product updated successfully", data: { product: await productService.update(req.params.productId, req.body) } }));
export const deleteProduct = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Product deactivated successfully", data: { product: await productService.remove(req.params.productId) } }));
export const listVariants = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Variants retrieved successfully", data: { variants: await productService.listVariants(req.params.productId, req.user) } }));
export const getVariant = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Variant retrieved successfully", data: { variant: await productService.getVariant(req.params.productId, req.params.variantId, req.user) } }));
export const createVariant = asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Variant created successfully", data: { variant: await productService.createVariant(req.params.productId, req.body) } }));
export const updateVariant = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Variant updated successfully", data: { variant: await productService.updateVariant(req.params.productId, req.params.variantId, req.body) } }));
export const deleteVariant = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Variant deactivated successfully", data: { variant: await productService.removeVariant(req.params.productId, req.params.variantId) } }));
export const getProductCosting = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const product = await productService.getById(productId, req.user);
  if (!product) throw AppError.notFound("Product not found");

  const variantCostings = [];
  for (const variant of product.variants || []) {
    const recipe = await Recipe.findOne({
      product: product._id,
      variant: variant._id,
      isActive: true,
    }).populate("ingredients.ingredient", "name unit isActive");

    if (recipe) {
      const costing = await recipeCostingService.calculateRecipeCosting(recipe, variant.price, product);
      variantCostings.push({
        variantId: variant._id,
        variantName: variant.name,
        price: variant.price,
        hasRecipe: true,
        recipeRevision: recipe.revision,
        costing,
        totalUnitCost: costing?.unitCost ?? costing?.costs?.unitCost,
        unitCost: costing?.unitCost ?? costing?.costs?.unitCost,
        ingredientCost: costing?.ingredientCost ?? costing?.costs?.ingredientCost,
        electricityCost: costing?.electricityCost ?? costing?.costs?.electricityCost,
        packagingCost: costing?.packagingCost ?? costing?.costs?.packagingCost,
        totalProductionCost: costing?.totalProductionCost ?? costing?.costs?.totalBatchCost,
        grossProfit: costing?.profitability?.grossProfit,
        grossMarginPercentage: costing?.profitability?.grossMarginPercentage,
      });
    } else {
      variantCostings.push({
        variantId: variant._id,
        variantName: variant.name,
        price: variant.price,
        hasRecipe: false,
        costing: null,
      });
    }
  }

  return ApiResponse.success(res, {
    message: "Product costing and margin analysis retrieved successfully",
    data: {
      productId: product._id,
      productName: product.name,
      variants: variantCostings,
    },
  });
});

export const feedbackSummary = asyncHandler(async (req, res) => ApiResponse.success(res, { data: { summary: await customerEngagementService.ratingSummary(req.params.productId) } }));

// Kept here for controller route composition and role clarity.
export const managementRoles = [
  USER_ROLES.OWNER_MANAGER,
  USER_ROLES.OWNER,
  USER_ROLES.MANAGER,
];
export default { createProduct, listProducts, getProduct, updateProduct, deleteProduct, listVariants, getVariant, createVariant, updateVariant, deleteVariant, feedbackSummary, getProductCosting };
