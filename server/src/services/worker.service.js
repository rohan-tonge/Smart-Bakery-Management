import mongoose from "mongoose";
import User from "../models/user.model.js";
import ProductionBatch from "../models/productionBatch.model.js";
import AppError from "../utils/appError.js";
import { USER_ROLES, PRODUCTION_STATUS } from "../utils/constants.js";

const assertId = (id) => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest("Invalid worker ID");
};
const workerFields =
  "name email phone role isActive jobDesignation hourlyLabourRate createdAt updatedAt";

class WorkerService {
  async create(input) {
    try {
      return await User.create({ ...input, role: USER_ROLES.PRODUCTION_STAFF });
    } catch (error) {
      if (error.code === 11000)
        throw AppError.conflict("A user with this email already exists");
      throw error;
    }
  }
  async list({ page = 1, limit = 20, search, isActive }) {
    const filter = { role: USER_ROLES.PRODUCTION_STAFF };
    if (isActive !== undefined) filter.isActive = isActive;
    if (search)
      filter.$or = [
        {
          name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        },
        {
          email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        },
      ];
    const [workers, total] = await Promise.all([
      User.find(filter)
        .select(workerFields)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter),
    ]);
    return {
      workers,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }
  async get(id) {
    assertId(id);
    const worker = await User.findOne({
      _id: id,
      role: USER_ROLES.PRODUCTION_STAFF,
    }).select(workerFields);
    if (!worker) throw AppError.notFound("Worker not found");
    const assignments = await ProductionBatch.find({
      "assignedWorkers.worker": id,
    })
      .select(
        "batchNumber product productVariant plannedQuantity status plannedStartTime actualStartTime actualCompletionTime",
      )
      .populate("product", "name")
      .sort({ plannedStartTime: 1 });
    return { worker, assignments };
  }
  async update(id, input) {
    assertId(id);
    const worker = await User.findOne({
      _id: id,
      role: USER_ROLES.PRODUCTION_STAFF,
    });
    if (!worker) throw AppError.notFound("Worker not found");
    Object.assign(worker, input);
    if (input.isActive === false) worker.refreshTokenHash = null;
    await worker.save();
    return worker;
  }
  async deactivate(id) {
    return this.update(id, { isActive: false });
  }
  async ownBatches(userId, { page = 1, limit = 20, date, active, status }) {
    const baseFilter = { "assignedWorkers.worker": userId };
    const filter = { ...baseFilter };

    const ACTIVE_STATUSES = [
      PRODUCTION_STATUS.PLANNED,
      PRODUCTION_STATUS.ACCEPTED,
      PRODUCTION_STATUS.VERIFIED,
      PRODUCTION_STATUS.IN_PRODUCTION,
      PRODUCTION_STATUS.PACKAGING,
      PRODUCTION_STATUS.PACKAGED,
    ];

    if (active === "true" || active === true) {
      filter.status = { $in: ACTIVE_STATUSES };
    } else if (status) {
      filter.status = status;
    }

    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 86400000);
      filter.$or = [
        { plannedStartTime: { $gte: start, $lt: end } },
        { productionDate: { $gte: start, $lt: end } },
      ];
    }
    const [batches, total, totalAll, totalActive] = await Promise.all([
      ProductionBatch.find(filter)
        .select("-costing -consumedIngredients.unitCostSnapshot -consumedIngredients.purchase -consumedIngredients.vendor -consumedIngredients.supplierNameSnapshot")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("product", "name")
        .populate("recipe", "preparationTime productionTime duration powerMinutes equipmentPowerKw electricityTariff packagingCostPerUnit packagingMaterials estimatedDurationMinutes")
        .populate("relatedOrders", "orderNumber status specialInstructions packInstructions items deliveryDate deliveryTimeSlot contactName contactPhone createdAt"),
      ProductionBatch.countDocuments(filter),
      ProductionBatch.countDocuments(baseFilter),
      ProductionBatch.countDocuments({ ...baseFilter, status: { $in: ACTIVE_STATUSES } }),
    ]);
    return {
      batches,
      meta: {
        page,
        limit,
        total,
        totalAll,
        totalActive,
        pages: Math.ceil(total / limit),
      },
    };
  }
}

export const workerService = new WorkerService();
export default workerService;
