import mongoose from "mongoose";
import { PRODUCTION_STATUS, UNITS } from "../utils/constants.js";

const ingredientLine = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0.000001 },
  unit: { type: String, enum: Object.values(UNITS), required: true },
}, { _id: false });
const workerAssignment = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  assignedAt: { type: Date, default: Date.now },
  task: { type: String, trim: true, maxlength: 200, default: "" },
  taskStatus: { type: String, enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"], default: "PENDING" },
  hourlyRateSnapshot: { type: Number, min: 0, default: null },
  actualHours: { type: Number, min: 0, default: null },
}, { _id: false });
const assignmentRejection = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, trim: true, maxlength: 1000, default: "" },
  rejectedAt: { type: Date, required: true, default: Date.now },
}, { _id: false });
const reassignmentRecord = new mongoose.Schema({
  previousWorker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  newWorker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reassignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, trim: true, maxlength: 1000, required: true },
  reassignedAt: { type: Date, required: true, default: Date.now },
}, { _id: false });
const packageRecordSchema = new mongoose.Schema({
  packageNumber: { type: Number, min: 1 },
  quantity: { type: Number, required: true, min: 0.000001 },
  unit: { type: String, enum: Object.values(UNITS), required: true },
  remark: { type: String, trim: true, maxlength: 500, default: "" },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  orderNumber: { type: String, default: "" },
}, { _id: false });
const acceptedPlanSchema = new mongoose.Schema({
  batchNumber: { type: String, required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  plannedQuantity: { type: Number, required: true, min: 0.000001 },
  relatedOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  assignedWorkers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { _id: false });
const consumedLine = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
  ingredientName: { type: String, required: true },
  lot: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryLot", required: true },
  lotNumber: { type: String, required: true },
  purchase: { type: mongoose.Schema.Types.ObjectId, ref: "Purchase", default: null },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
  supplierNameSnapshot: { type: String, default: "" },
  quantity: { type: Number, required: true, min: 0.000001 },
  unit: { type: String, enum: Object.values(UNITS), required: true },
  unitCostSnapshot: { type: Number, min: 0, default: undefined },
}, { _id: false });

const holdAuditEntrySchema = new mongoose.Schema({
  action: { type: String, required: true }, // "HOLD_PLACED", "INSTRUCTION_UPDATED", "BAKER_ACKNOWLEDGED", "HOLD_RESOLVED"
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  actorRole: { type: String, default: "" },
  reason: { type: String, default: "" },
  instruction: { type: String, default: "" },
  note: { type: String, default: "" },
  resolution: { type: String, default: "" },
  bakerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const holdStateSchema = new mongoose.Schema({
  isOnHold: { type: Boolean, default: false, index: true },
  holdReason: { type: String, default: "" },
  holdInstruction: { type: String, default: "" },
  ownerNote: { type: String, default: "" },
  holdRequestedAt: { type: Date, default: null },
  holdRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  instructionVersion: { type: Number, default: 0 },
  permittedStep: { type: String, default: "" },
  stepFinishedReported: { type: Boolean, default: false },
  bakerAcknowledged: { type: Boolean, default: false },
  bakerAcknowledgedAt: { type: Date, default: null },
  bakerAcknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  bakerResponse: {
    currentStage: { type: String, default: "" },
    workCompleted: { type: String, default: "" },
    ingredientsConsumed: { type: Boolean, default: false },
    safeStoppingPointReached: { type: Boolean, default: false },
    note: { type: String, default: "" },
  },
  holdResolvedAt: { type: Date, default: null },
  holdResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  holdResolution: { type: String, default: "" },
  resolutionNote: { type: String, default: "" },
  auditTrail: { type: [holdAuditEntrySchema], default: [] },
}, { _id: false });
const expenseSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true, maxlength: 120 },
  amountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  notes: { type: String, trim: true, maxlength: 500, default: "" },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recordedAt: { type: Date, required: true, default: Date.now },
}, { _id: false });
const materialCostSnapshotSchema = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
  ingredientName: { type: String, required: true },
  lot: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryLot", required: true },
  lotNumber: { type: String, required: true },
  purchase: { type: mongoose.Schema.Types.ObjectId, ref: "Purchase", default: null },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
  supplierNameSnapshot: { type: String, default: "" },
  quantity: { type: Number, required: true },
  unit: { type: String, enum: Object.values(UNITS), required: true },
  unitCostSnapshot: { type: Number, required: true, min: 0 },
  costPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
}, { _id: false });
const packagingSnapshotSchema = new mongoose.Schema({
  materialName: { type: String, required: true },
  consumptionType: { type: String, enum: ["PER_PIECE", "PER_BATCH"], default: "PER_PIECE" },
  quantityUsed: { type: Number, required: true, min: 0 },
  costPerUnit: { type: Number, required: true, min: 0 },
  costPaise: { type: Number, required: true, min: 0 },
}, { _id: false });

const electricitySnapshotSchema = new mongoose.Schema({
  equipmentName: { type: String, default: "Commercial Baking Oven" },
  powerKw: { type: Number, min: 0, default: 0 },
  runtimeMinutes: { type: Number, min: 0, default: 0 },
  runtimeHours: { type: Number, min: 0, default: 0 },
  tariffPerKwh: { type: Number, min: 0, default: 0 },
  energyKwh: { type: Number, min: 0, default: 0 },
  costPaise: { type: Number, min: 0, default: 0 },
  basis: { type: String, default: "MEASURED_EQUIPMENT_RUNTIME" },
}, { _id: false });

const costSchema = new mongoose.Schema({
  status: { type: String, enum: ["NOT_FINALIZED", "FINALIZING", "FINALIZED"], default: "NOT_FINALIZED" },
  ingredientCostPaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: undefined },
  labourCostPaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: undefined },
  packagingCostPaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: undefined },
  electricityCostPaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: 0 },
  otherExpensePaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: undefined },
  wastageCostPaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: undefined },
  totalCostPaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: undefined },
  costPerUsableItemPaise: { type: Number, min: 0, default: undefined },
  costPerUsableItemStatus: { type: String, enum: ["COMPUTABLE", "UNAVAILABLE"], default: "UNAVAILABLE" },
  materialSnapshots: { type: [materialCostSnapshotSchema], default: [] },
  labourSnapshots: [{ worker: mongoose.Schema.Types.ObjectId, workerName: String, hourlyRateSnapshot: Number, actualHours: Number, costPaise: Number }],
  expenses: { type: [expenseSchema], default: [] },
  packagingSnapshots: { type: [packagingSnapshotSchema], default: [] },
  electricitySnapshot: { type: electricitySnapshotSchema, default: null },
  packagingBasis: { type: String, enum: ["PIECE_BASED", "FIXED_BATCH", "ITEMIZED_MATERIALS"], default: "PIECE_BASED" },
  calculatedAt: { type: Date, default: null },
  finalizedAt: { type: Date, default: null },
  finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { _id: false });

const productionBatchSchema = new mongoose.Schema({
  batchNumber: { type: String, required: true, unique: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  productVariant: { type: mongoose.Schema.Types.ObjectId, required: true },
  productSnapshot: {
    productName: { type: String, required: true },
    variantName: { type: String, required: true },
    variantQuantity: { type: Number, required: true },
    variantUnit: { type: String, enum: Object.values(UNITS), required: true },
    totalTimeMinutes: { type: Number, default: undefined },
    preparationTimePerUnit: { type: Number, default: undefined },
    electricityCostPerUnit: { type: Number, default: undefined },
    packagingCostPerUnit: { type: Number, default: undefined },
  },
  recipe: { type: mongoose.Schema.Types.ObjectId, ref: "Recipe", required: true },
  recipeRevision: { type: Number, required: true, min: 1 },
  recipeSnapshot: {
    expectedYield: { type: Number, required: true },
    yieldUnit: { type: String, enum: Object.values(UNITS), required: true },
    recipeBatchQuantity: { type: Number, required: true, min: 0.000001 },
    ingredients: { type: [ingredientLine], required: true },
    preparationTime: { type: Number, default: 0 },
    productionTime: { type: Number, default: 0 },
    powerMinutes: { type: Number, default: null },
    powerCostPerMinute: { type: Number, default: 0 },
    estimatedDurationMinutes: { type: Number, default: undefined },
    equipmentPowerKw: { type: Number, default: undefined },
    electricityTariff: { type: Number, default: undefined },
    packagingCostPerUnit: { type: Number, default: 0 },
    packagingMaterials: { type: Array, default: [] },
  },
  plannedQuantity: { type: Number, required: true, min: 0.000001 },
  estimatedDurationMinutes: { type: Number, min: 1, default: undefined },
  producedQuantity: { type: Number, min: 0, default: undefined },
  usableQuantity: { type: Number, min: 0, default: undefined },
  wastageQuantity: { type: Number, min: 0, default: undefined },
  actualOutputQuantity: { type: Number, min: 0, default: undefined },
  actualOutputUnit: { type: String, enum: Object.values(UNITS), default: undefined },
  bakerOutputRemark: { type: String, trim: true, maxlength: 1000, default: "" },
  ownerInstructions: { type: String, trim: true, maxlength: 3000, default: "" },
  packagingRemark: { type: String, trim: true, maxlength: 1000, default: "" },
  equipmentRuntimeMinutes: { type: Number, min: 0, default: undefined },
  delayReason: { type: String, trim: true, maxlength: 1000, default: "" },
  unit: { type: String, enum: Object.values(UNITS), required: true },
  status: { type: String, enum: Object.values(PRODUCTION_STATUS), default: PRODUCTION_STATUS.PLANNED, index: true },
  productionDate: { type: Date, default: null, index: true },
  timeSlot: {
    startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  },
  planningKey: { type: String, default: undefined, unique: true, sparse: true },
  planningStatus: { type: String, enum: ["DRAFT", "FEASIBLE", "INFEASIBLE", "APPROVED"], default: undefined },
  planningFeasibility: { type: mongoose.Schema.Types.Mixed, default: null },
  resourceChecks: { type: mongoose.Schema.Types.Mixed, default: null },
  planningCheckedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null },
  assignedWorkers: { type: [workerAssignment], default: [] },
  assignmentRejections: { type: [assignmentRejection], default: [] },
  reassignments: { type: [reassignmentRecord], default: [] },
  acceptedPlan: { type: acceptedPlanSchema, default: null },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  acceptedAt: { type: Date, default: null },
  verificationStatus: { type: String, enum: ["PENDING", "VERIFIED"], default: "PENDING" },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verifiedAt: { type: Date, default: null },
  plannedStartTime: { type: Date, default: null },
  actualStartTime: { type: Date, default: null },
  bakingStartTime: { type: Date, default: null },
  bakingEndTime: { type: Date, default: null },
  actualCompletionTime: { type: Date, default: null },
  productionCompletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  qualityCheck: {
    result: { type: String, enum: ["PASS", "FAIL"], default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    checkedAt: { type: Date, default: null },
  },
  packages: { type: [packageRecordSchema], default: [] },
  packagedQuantity: { type: Number, min: 0, default: undefined },
  unpackagedQuantity: { type: Number, min: 0, default: 0 },
  wipDisposition: { type: String, enum: ["REMAINING_WIP", "REWORK", "SAMPLED", "DISCARDED", "NONE"], default: "NONE" },
  packagedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  packagedAt: { type: Date, default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  completedAt: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectedAt: { type: Date, default: null },
  rejectionReason: { type: String, trim: true, maxlength: 1000, default: "" },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  cancelledAt: { type: Date, default: null },
  cancellationReason: { type: String, trim: true, maxlength: 1000, default: "" },
  batchType: {
    type: String,
    enum: ["CUSTOMER_ORDER", "PLANNED_PRODUCTION"],
    default: "CUSTOMER_ORDER",
    index: true,
  },
  plannedReason: {
    type: String,
    trim: true,
    maxlength: 200,
    default: "",
  },
  priority: {
    type: String,
    enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
    default: "NORMAL",
  },
  productionNotes: { type: String, trim: true, maxlength: 3000, default: "" },
  relatedOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  consumedIngredients: { type: [consumedLine], default: [] },
  costing: { type: costSchema, default: () => ({}) },
  wastageWriteCount: { type: Number, min: 0, default: 0 },
  consumptionStatus: { type: String, enum: ["NOT_STARTED", "PROCESSING", "CONSUMED"], default: "NOT_STARTED" },
  completionStatus: { type: String, enum: ["NOT_STARTED", "PROCESSING", "DONE"], default: "NOT_STARTED" },
  packagingStatus: { type: String, enum: ["NOT_STARTED", "PROCESSING", "DONE"], default: "NOT_STARTED" },
  syncOrderStatus: { type: Boolean, default: false },
  holdState: { type: holdStateSchema, default: () => ({}) },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

productionBatchSchema.index({ status: 1, plannedStartTime: 1 });
productionBatchSchema.index({ productionDate: 1, planningStatus: 1 });
productionBatchSchema.index({ "assignedWorkers.worker": 1, status: 1 });
productionBatchSchema.index({ relatedOrders: 1 });
productionBatchSchema.index({ createdAt: 1 });
productionBatchSchema.index({ status: 1, actualCompletionTime: 1 });
productionBatchSchema.index({ "costing.status": 1, "costing.finalizedAt": 1 });

export const ProductionBatch = mongoose.model("ProductionBatch", productionBatchSchema);
export default ProductionBatch;
