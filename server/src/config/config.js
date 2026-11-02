import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),
  ORDER_RESERVATION_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  MONGO_URI: z.string({
    required_error: "MONGO_URI is required. Please set it in your .env file.",
  }).min(1, "MONGO_URI cannot be empty"),
  MONGO_DB_NAME: z.string().default("smart_bakery_db"),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

  ACCESS_TOKEN_SECRET: z.string({
    required_error: "ACCESS_TOKEN_SECRET is required. Please configure it in .env",
  }).min(16, "ACCESS_TOKEN_SECRET must be at least 16 characters long"),
  ACCESS_TOKEN_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/i).default("15m"),

  REFRESH_TOKEN_SECRET: z.string({
    required_error: "REFRESH_TOKEN_SECRET is required. Please configure it in .env",
  }).min(16, "REFRESH_TOKEN_SECRET must be at least 16 characters long"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/i).default("7d"),

  COOKIE_SECRET: z.string().optional(),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).optional(),

  // Optional Third-Party Services
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(""),
  CLOUDINARY_API_KEY: z.string().optional().default(""),
  CLOUDINARY_API_SECRET: z.string().optional().default(""),

  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),
  RAZORPAY_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default("INR"),
  RAZORPAY_API_BASE_URL: z.string().url().refine((value) => new URL(value).protocol === "https:", "Razorpay API URL must use HTTPS").default("https://api.razorpay.com"),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  EMAIL_FROM: z.string().optional().default("noreply@smartbakery.com"),
});

const paymentConfigured = Boolean(process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET);
if (paymentConfigured && process.env.NODE_ENV !== "test") {
  const missing = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"].filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Payment configuration is incomplete: ${missing.join(", ")}`);
    process.exit(1);
  }
}
if ((process.env.NODE_ENV || "development") === "development" && process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.startsWith("rzp_test_")) {
  console.error("Development payment configuration must use a Razorpay Test Mode key ID (rzp_test_...).");
  process.exit(1);
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formattedErrors = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  console.error("==================================================");
  console.error("CRITICAL CONFIGURATION ERROR: Invalid environment variables:");
  console.error(formattedErrors);
  console.error("Please verify your .env file against .env.example.");
  console.error("==================================================");
  process.exit(1);
}

const env = parsed.data;
// Test suites must never point at the configured business database.
const databaseName = env.NODE_ENV === "test"
  ? `${env.MONGO_DB_NAME}_test`
  : env.MONGO_DB_NAME;
const durationToMilliseconds = (duration) => {
  const [, amount, unit] = duration.match(/^(\d+)([smhd])$/i);
  const factors = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(amount) * factors[unit.toLowerCase()];
};

const productionSecretNames = ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET", "COOKIE_SECRET"];
if (env.NODE_ENV === "production") {
  const invalidSecrets = productionSecretNames.filter((name) => {
    const secret = process.env[name] || "";
    return secret.length < 32 || /your_.*secret|replace_with|placeholder|change.?me|default|example/i.test(secret);
  });
  if (invalidSecrets.length) {
    console.error(`Production requires unique, non-placeholder secrets of at least 32 characters: ${invalidSecrets.join(", ")}`);
    process.exit(1);
  }
  if (process.env.ACCESS_TOKEN_SECRET === process.env.REFRESH_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET === process.env.COOKIE_SECRET || process.env.REFRESH_TOKEN_SECRET === process.env.COOKIE_SECRET) {
    console.error("Production ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET, and COOKIE_SECRET must be different values.");
    process.exit(1);
  }
  const productionOrigins = [env.CORS_ORIGIN, env.FRONTEND_URL].flatMap((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean));
  if (!productionOrigins.length || productionOrigins.some((origin) => origin === "*" || !/^https:\/\//i.test(origin))) {
    console.error("Production CORS_ORIGIN and FRONTEND_URL must contain explicit HTTPS origins; wildcard origins are not allowed.");
    process.exit(1);
  }
}

export const config = Object.freeze({
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  orders: { reservationMinutes: env.ORDER_RESERVATION_MINUTES },
  isProduction: env.NODE_ENV === "production",
  isDevelopment: env.NODE_ENV === "development",
  isTest: env.NODE_ENV === "test",

  db: {
    uri: env.MONGO_URI,
    dbName: databaseName,
  },

  cors: {
    origins: [...new Set([env.CORS_ORIGIN, env.FRONTEND_URL].flatMap((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)))],
  },

  jwt: {
    accessTokenSecret: env.ACCESS_TOKEN_SECRET,
    accessTokenExpiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
    refreshTokenSecret: env.REFRESH_TOKEN_SECRET,
    refreshTokenExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN,
    refreshTokenMaxAgeMs: durationToMilliseconds(env.REFRESH_TOKEN_EXPIRES_IN),
    cookieSecret: env.COOKIE_SECRET || "smart-bakery-development-cookie-secret",
    cookieSameSite: env.COOKIE_SAME_SITE || (env.NODE_ENV === "production" ? "none" : "lax"),
  },

  cloudinary: {
    isConfigured: Boolean(
      env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
    ),
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
  },

  razorpay: {
    isConfigured: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET),
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    currency: env.RAZORPAY_CURRENCY,
    apiBaseUrl: env.RAZORPAY_API_BASE_URL,
  },

  smtp: {
    isConfigured: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD),
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.EMAIL_FROM,
  },
});

export default config;
