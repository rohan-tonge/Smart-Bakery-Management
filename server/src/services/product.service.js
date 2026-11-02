import mongoose from "mongoose";
import Product from "../models/product.model.js";
import Category from "../models/category.model.js";
import Recipe from "../models/recipe.model.js";
import AppError from "../utils/appError.js";
import { getPaginationMetadata } from "../utils/pagination.js";
import { USER_ROLES } from "../utils/constants.js";

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const canManage = (user) =>
  Boolean(
    user &&
      [
        USER_ROLES.OWNER,
        USER_ROLES.MANAGER,
        USER_ROLES.OWNER_MANAGER,
      ].includes(user.role),
  );
const assertObjectId = (id, field = "id") => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest(`Invalid ${field}`);
};
const ensureCategory = async (id) => {
  assertObjectId(id, "category ID");
  const category = await Category.findOne({ _id: id, isActive: true });
  if (!category)
    throw AppError.badRequest("Product category does not exist or is inactive");
};
const productQuery = (id, manager) => ({
  _id: id,
  ...(manager ? {} : { isActive: true, isAvailable: true }),
});

class ProductService {
  async create(input) {
    await ensureCategory(input.category);
    const combinedTotal = input.totalTimeMinutes !== undefined
      ? Number(input.totalTimeMinutes)
      : (input.totalTime !== undefined
        ? Number(input.totalTime)
        : ((Number(input.preparationTimePerUnit ?? input.preparationTime ?? 0)) + (Number(input.productionTime ?? 0))));
    const prep = input.preparationTimePerUnit !== undefined
      ? input.preparationTimePerUnit
      : (input.preparationTime !== undefined ? input.preparationTime : combinedTotal);
    return Product.create({
      ...input,
      totalTimeMinutes: combinedTotal,
      preparationTimePerUnit: prep,
      preparationTime: prep,
      electricityCostPerUnit: input.electricityCostPerUnit !== undefined ? Number(input.electricityCostPerUnit) : 0,
      packagingCostPerUnit: input.packagingCostPerUnit !== undefined ? Number(input.packagingCostPerUnit) : 0,
      imageUrl: input.imageUrl || input.images?.[0] || "",
      slug: slugify(input.slug || input.name),
    });
  }

  async list({
    user,
    page,
    limit,
    search,
    category,
    available,
    minPrice,
    maxPrice,
  }) {
    const manager = canManage(user);
    // Deletion is a soft deactivation. Keep inactive products out of the
    // default catalog response for managers too, so a successful delete is
    // reflected anywhere that reloads the product list.
    const filter = manager
      ? { isActive: true }
      : { isActive: true, isAvailable: true };
    const clauses = [];
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      clauses.push({
        $or: [
          { name: { $regex: safeSearch, $options: "i" } },
          { description: { $regex: safeSearch, $options: "i" } },
          { tags: { $regex: safeSearch, $options: "i" } },
        ],
      });
    }
    if (category) {
      assertObjectId(category, "category ID");
      filter.category = category;
    }
    if (available !== undefined && manager) filter.isAvailable = available;
    if (minPrice !== undefined || maxPrice !== undefined) {
      const range = {};
      if (minPrice !== undefined) range.$gte = minPrice;
      if (maxPrice !== undefined) range.$lte = maxPrice;
      clauses.push({
        $or: [
          { basePrice: range },
          {
            variants: {
              $elemMatch: { isActive: true, isAvailable: true, price: range },
            },
          },
        ],
      });
    }
    if (clauses.length) filter.$and = clauses;
    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate("category", "name slug")
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Product.countDocuments(filter),
    ]);
    return { products, meta: getPaginationMetadata(total, page, limit) };
  }

  async getById(id, user) {
    assertObjectId(id, "product ID");
    const product = await Product.findOne(
      productQuery(id, canManage(user)),
    ).populate("category", "name slug");
    if (!product) throw AppError.notFound("Product not found");
    return product;
  }

  async update(id, input) {
    assertObjectId(id, "product ID");
    const product = await Product.findById(id);
    if (!product) throw AppError.notFound("Product not found");
    if (input.category) await ensureCategory(input.category);
    if (input.isActive === true || input.isAvailable === true)
      await ensureCategory(input.category || product.category);
    if (input.totalTimeMinutes !== undefined || input.totalTime !== undefined) {
      const total = Number(input.totalTimeMinutes ?? input.totalTime);
      input.totalTimeMinutes = total;
      input.preparationTime = total;
      input.preparationTimePerUnit = total;
      input.productionTime = 0;
    } else if (input.preparationTimePerUnit !== undefined && input.preparationTime === undefined) {
      input.preparationTime = input.preparationTimePerUnit;
    } else if (input.preparationTime !== undefined && input.preparationTimePerUnit === undefined) {
      input.preparationTimePerUnit = input.preparationTime;
    }
    if (
      input.totalTimeMinutes === undefined &&
      (input.preparationTime !== undefined || input.productionTime !== undefined)
    ) {
      const pPrep = input.preparationTime !== undefined ? Number(input.preparationTime) : Number(product.preparationTime || 0);
      const pProd = input.productionTime !== undefined ? Number(input.productionTime) : Number(product.productionTime || 0);
      input.totalTimeMinutes = pPrep + pProd;
    }
    Object.assign(product, input);
    if (input.name && !input.slug) product.slug = slugify(input.name);
    if (input.slug) product.slug = slugify(input.slug);
    if (!product.isActive) product.isAvailable = false;
    await product.save();
    if (
      input.totalTimeMinutes !== undefined ||
      input.totalTime !== undefined ||
      input.preparationTimePerUnit !== undefined ||
      input.preparationTime !== undefined ||
      input.productionTime !== undefined
    ) {
      if (product.variants?.length) {
        for (const variant of product.variants) {
          await this.ensureVariantRecipe(product, variant);
        }
      }
    }
    return product.populate("category", "name slug");
  }

  async remove(id) {
    return this.update(id, { isActive: false, isAvailable: false });
  }

  async getProductForVariant(productId, user) {
    assertObjectId(productId, "product ID");
    const product = await Product.findOne(
      productQuery(productId, canManage(user)),
    );
    if (!product) throw AppError.notFound("Product not found");
    return product;
  }

  async listVariants(productId, user) {
    const product = await this.getProductForVariant(productId, user);
    const variants = product.variants.filter(
      (variant) => canManage(user) || (variant.isActive && variant.isAvailable),
    );
    return variants;
  }

  async getVariant(productId, variantId, user) {
    assertObjectId(variantId, "variant ID");
    const product = await this.getProductForVariant(productId, user);
    const variant = product.variants.id(variantId);
    if (
      !variant ||
      (!canManage(user) && (!variant.isActive || !variant.isAvailable))
    )
      throw AppError.notFound("Variant not found");
    return variant;
  }

  async createVariant(productId, input) {
    assertObjectId(productId, "product ID");
    const product = await Product.findById(productId);
    if (!product) throw AppError.notFound("Product not found");
    const duplicate = product.variants.some(
      (variant) =>
        variant.name.toLowerCase() === input.name.toLowerCase() &&
        variant.quantity === input.quantity &&
        variant.unit === input.unit,
    );
    if (duplicate)
      throw AppError.conflict(
        "A matching variant already exists for this product",
      );
    product.variants.push(input);
    await product.save();
    const createdVariant = product.variants.at(-1);
    if ((product.preparationTime || 0) + (product.productionTime || 0) > 0) {
      await this.ensureVariantRecipe(product, createdVariant);
    }
    return createdVariant;
  }

  async ensureVariantRecipe(product, variant) {
    if (!product || !variant) return null;
    const prep = Number(product.preparationTime || 0);
    const prod = Number(product.productionTime || 0);
    const total = prep + prod;
    if (total <= 0) return null;

    let recipe = await Recipe.findOne({
      product: product._id,
      variant: variant._id,
      isActive: true,
    });

    if (recipe) {
      if ((recipe.preparationTime || 0) + (recipe.productionTime || 0) <= 0) {
        recipe.preparationTime = prep;
        recipe.productionTime = prod;
        recipe.revision = (recipe.revision || 1) + 1;
        await recipe.save();
      }
      return recipe;
    }

    let ingredients = [];
    try {
      const Ingredient = (await import("../models/ingredient.model.js")).default;
      const baseIngredient = await Ingredient.findOne({ isActive: true });
      if (baseIngredient) {
        ingredients = [{ ingredient: baseIngredient._id, quantity: 0.1, unit: baseIngredient.unit || "kg" }];
      }
    } catch {
      // ignore
    }

    try {
      recipe = await Recipe.create({
        product: product._id,
        variant: variant._id,
        preparationTime: prep,
        productionTime: prod,
        expectedYield: 1,
        yieldUnit: variant.unit || "piece",
        instructions: `Standard production for ${product.name} (${variant.name})`,
        ingredients,
        isActive: true,
      });
      return recipe;
    } catch {
      return Recipe.findOne({ product: product._id, variant: variant._id, isActive: true });
    }
  }

  async updateVariant(productId, variantId, input) {
    assertObjectId(productId, "product ID");
    assertObjectId(variantId, "variant ID");
    const product = await Product.findById(productId);
    if (!product) throw AppError.notFound("Product not found");
    const variant = product.variants.id(variantId);
    if (!variant) throw AppError.notFound("Variant not found");
    const candidate = { ...variant.toObject(), ...input };
    const duplicate = product.variants.some(
      (other) =>
        other._id.toString() !== variantId &&
        other.name.toLowerCase() === candidate.name.toLowerCase() &&
        other.quantity === candidate.quantity &&
        other.unit === candidate.unit,
    );
    if (duplicate)
      throw AppError.conflict(
        "A matching variant already exists for this product",
      );
    Object.assign(variant, input);
    if (!variant.isActive) variant.isAvailable = false;
    await product.save();
    return variant;
  }

  async removeVariant(productId, variantId) {
    return this.updateVariant(productId, variantId, {
      isActive: false,
      isAvailable: false,
    });
  }
}

export const productService = new ProductService();
export default productService;
