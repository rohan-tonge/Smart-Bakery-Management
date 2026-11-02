import mongoose from "mongoose";
import Vendor from "../models/vendor.model.js";
import AppError from "../utils/appError.js";
import { getPaginationMetadata } from "../utils/pagination.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const assertId = (id) => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest("Invalid vendor ID");
};

class VendorService {
  async create(input) {
    const name = input.name.trim().replace(/\s+/g, " ");
    if (
      await Vendor.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, "i") })
    ) {
      throw AppError.conflict("A vendor with this name already exists");
    }
    return Vendor.create({ ...input, name });
  }

  async list({ page, limit, search, isActive }) {
    const filter = { isActive: isActive ?? true };
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { name: expression },
        { contactPerson: expression },
        { phone: expression },
        { email: expression },
      ];
    }
    const [vendors, total] = await Promise.all([
      Vendor.find(filter)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Vendor.countDocuments(filter),
    ]);
    return { vendors, meta: getPaginationMetadata(total, page, limit) };
  }

  async getById(id) {
    assertId(id);
    const vendor = await Vendor.findById(id);
    if (!vendor) throw AppError.notFound("Vendor not found");
    return vendor;
  }

  async update(id, input) {
    assertId(id);
    const vendor = await Vendor.findById(id);
    if (!vendor) throw AppError.notFound("Vendor not found");
    if (input.name) {
      input.name = input.name.trim().replace(/\s+/g, " ");
      if (
        await Vendor.findOne({
          _id: { $ne: vendor._id },
          name: new RegExp(`^${escapeRegex(input.name)}$`, "i"),
        })
      ) {
        throw AppError.conflict("A vendor with this name already exists");
      }
    }
    Object.assign(vendor, input);
    await vendor.save();
    return vendor;
  }

  async deactivate(id) {
    assertId(id);
    const vendor = await Vendor.findById(id);
    if (!vendor) throw AppError.notFound("Vendor not found");
    vendor.isActive = false;
    await vendor.save();
    return vendor;
  }
}

export const vendorService = new VendorService();
export default vendorService;
