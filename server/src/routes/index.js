import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import categoryRoutes from "./category.routes.js";
import productRoutes from "./product.routes.js";
import ingredientRoutes from "./ingredient.routes.js";
import recipeRoutes from "./recipe.routes.js";
import vendorRoutes from "./vendor.routes.js";
import purchaseRoutes from "./purchase.routes.js";
import inventoryRoutes from "./inventory.routes.js";
import cartRoutes from "./cart.routes.js";
import orderRoutes from "./order.routes.js";
import paymentRoutes from "./payment.routes.js";
import workerRoutes from "./worker.routes.js";
import productionRoutes from "./production.routes.js";
import wastageRoutes from "./wastage.routes.js";
import costingRoutes from "./costing.routes.js";
import profitabilityRoutes from "./profitability.routes.js";
import analyticsRoutes from "./analytics.routes.js";
import feedbackRoutes from "./feedback.routes.js";
import complaintRoutes from "./complaint.routes.js";
import notificationRoutes from "./notification.routes.js";
import alertRoutes from "./alert.routes.js";
import settingRoutes from "./setting.routes.js";
import requisitionRoutes from "./requisition.routes.js";

const apiV1Router = Router();

// Base health check -> /api/v1/health
apiV1Router.use("/health", healthRoutes);

// Authentication routes -> /api/v1/auth
apiV1Router.use("/auth", authRoutes);

// User management routes -> /api/v1/users
apiV1Router.use("/users", userRoutes);
apiV1Router.use("/categories", categoryRoutes);
apiV1Router.use("/products", productRoutes);
apiV1Router.use("/ingredients", ingredientRoutes);
apiV1Router.use(recipeRoutes);
apiV1Router.use("/vendors", vendorRoutes);
apiV1Router.use("/purchases", purchaseRoutes);
apiV1Router.use("/inventory", inventoryRoutes);
apiV1Router.use("/cart", cartRoutes);
apiV1Router.use("/orders", orderRoutes);
apiV1Router.use("/payments", paymentRoutes);
apiV1Router.use("/workers", workerRoutes);
apiV1Router.use("/production", productionRoutes);
apiV1Router.use("/wastage", wastageRoutes);
apiV1Router.use("/costing", costingRoutes);
apiV1Router.use("/profitability", profitabilityRoutes);
apiV1Router.use("/analytics", analyticsRoutes);
apiV1Router.use("/feedback", feedbackRoutes);
apiV1Router.use("/complaints", complaintRoutes);
apiV1Router.use("/notifications", notificationRoutes);
apiV1Router.use("/alerts", alertRoutes);
apiV1Router.use("/settings", settingRoutes);
apiV1Router.use("/requisitions", requisitionRoutes);

export default apiV1Router;
