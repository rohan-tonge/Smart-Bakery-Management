import Category from "../models/category.model.js";
import Product from "../models/product.model.js";
import AppError from "../utils/appError.js";

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

class CategoryService {
  async create(input) {
    const payload = { ...input, imageUrl: input.imageUrl || input.image || "", slug: slugify(input.slug || input.name) };
    return Category.create(payload);
  }

  async list({ includeInactive = false } = {}) {
    const filter = includeInactive ? {} : { isActive: true };
    return Category.find(filter).sort({ sortOrder: 1, name: 1 });
  }

  async getById(id, includeInactive = false) {
    const category = await Category.findOne({
      _id: id,
      ...(includeInactive ? {} : { isActive: true }),
    });
    if (!category) throw AppError.notFound("Category not found");
    return category;
  }

  async update(id, input) {
    const category = await Category.findById(id);
    if (!category) throw AppError.notFound("Category not found");
    Object.assign(category, input);
    if (input.imageUrl !== undefined) category.image = input.imageUrl;
    if (input.name && !input.slug) category.slug = slugify(input.name);
    if (input.slug) category.slug = slugify(input.slug);
    await category.save();
    if (!category.isActive)
      await Product.updateMany(
        { category: category._id },
        { $set: { isActive: false, isAvailable: false } },
      );
    return category;
  }

  async remove(id) {
    const category = await Category.findById(id);
    if (!category) throw AppError.notFound("Category not found");
    category.isActive = false;
    await category.save();
    await Product.updateMany(
      { category: category._id },
      { $set: { isActive: false, isAvailable: false } },
    );
    return category;
  }
}

export const categoryService = new CategoryService();
export default categoryService;
