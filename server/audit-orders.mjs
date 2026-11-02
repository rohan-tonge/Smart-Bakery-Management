import mongoose from "mongoose";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart_bakery_db";
const DB_NAME = process.env.MONGO_DB_NAME || "smart_bakery_db";

async function inspect() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log(`Connected to database: ${mongoose.connection.name}`);

  const Order = mongoose.connection.collection("orders");
  const Payment = mongoose.connection.collection("payments");
  const PaymentProof = mongoose.connection.collection("paymentproofs");
  const ProductionBatch = mongoose.connection.collection("productionbatches");
  const IngredientRequisition = mongoose.connection.collection("ingredientrequisitions");
  const Notification = mongoose.connection.collection("notifications");
  const User = mongoose.connection.collection("users");
  const Product = mongoose.connection.collection("products");

  const totalOrders = await Order.countDocuments();
  const orders = await Order.find({}).sort({ createdAt: 1 }).toArray();

  const auditData = [];

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const user = o.customer ? await User.findOne({ _id: o.customer }) : null;
    const payments = await Payment.find({ order: o._id }).toArray();
    const proofs = await PaymentProof.find({ orderId: o._id }).toArray();
    const batches = await ProductionBatch.find({ relatedOrders: o._id }).toArray();
    const notifications = await Notification.find({ "metadata.orderId": String(o._id) }).toArray();

    // Check item product names to see if they are test products
    const itemNames = (o.items || []).map(it => it.productName);

    auditData.push({
      index: i + 1,
      _id: String(o._id),
      orderNumber: o.orderNumber,
      createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      orderType: o.orderType,
      contactName: o.contactName,
      contactPhone: o.contactPhone,
      customer: user ? {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      } : null,
      subtotal: o.subtotal,
      total: o.total,
      items: (o.items || []).map(it => ({
        productName: it.productName,
        variantName: it.variantName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
      })),
      linkedPayments: payments.map(p => ({
        id: String(p._id),
        method: p.method,
        status: p.status,
        amount: p.amount,
        transactionId: p.transactionId,
      })),
      linkedProofs: proofs.map(p => ({
        id: String(p._id),
        utrNumber: p.utrNumber,
        status: p.status,
      })),
      linkedBatches: batches.map(b => ({
        id: String(b._id),
        batchNumber: b.batchNumber,
        status: b.status,
      })),
      linkedNotificationsCount: notifications.length,
    });
  }

  fs.writeFileSync("audit_results.json", JSON.stringify(auditData, null, 2), "utf8");
  console.log(`Saved full audit of ${totalOrders} orders to audit_results.json`);

  await mongoose.disconnect();
}

inspect().catch(err => {
  console.error("Audit script failed:", err);
  process.exit(1);
});
