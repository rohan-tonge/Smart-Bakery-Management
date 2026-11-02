/**
 * Administrative Bootstrap Script for Smart Bakery Management System
 * Creates or updates the initial OWNER_MANAGER account in MongoDB.
 *
 * Usage:
 *   Initial creation:
 *     MONGO_URI="mongodb+srv://..." OWNER_EMAIL="owner@smartbakery.com" OWNER_PASSWORD="YourPassword123!" node server/scripts/bootstrap-owner.js
 *
 *   Intentional password reset for an existing owner:
 *     MONGO_URI="mongodb+srv://..." OWNER_EMAIL="owner@smartbakery.com" OWNER_PASSWORD="NewPassword123!" RESET_EXISTING_OWNER=true node server/scripts/bootstrap-owner.js
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const mongoUri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME || "smart_bakery_db";
const email = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
const password = process.env.OWNER_PASSWORD || "";
const name = process.env.OWNER_NAME || "Bakery Owner";
const phone = process.env.OWNER_PHONE || "9876543210";

if (!mongoUri) {
  console.error("Error: MONGO_URI environment variable is required.");
  process.exit(1);
}

if (process.env.NODE_ENV === "test" && !process.env.FORCE_TEST_BOOTSTRAP) {
  console.error("Error: Refusing to run bootstrap script in test environment unless FORCE_TEST_BOOTSTRAP=1 is set.");
  process.exit(1);
}

if (!email || !password) {
  console.error("Error: OWNER_EMAIL and OWNER_PASSWORD environment variables are required.");
  console.error("Example: MONGO_URI=\"...\" OWNER_EMAIL=\"owner@smartbakery.com\" OWNER_PASSWORD=\"StrongPassword123!\" node server/scripts/bootstrap-owner.js");
  process.exit(1);
}

if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error("Error: OWNER_EMAIL must be a valid email address.");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Error: OWNER_PASSWORD must be at least 8 characters long.");
  process.exit(1);
}

async function bootstrap() {
  console.log(`Connecting to MongoDB (${dbName})...`);
  await mongoose.connect(mongoUri, { dbName });
  console.log("Connected successfully.");

  const usersCollection = mongoose.connection.collection("users");

  const existingUser = await usersCollection.findOne({ email });

  const hashedPassword = await bcrypt.hash(password, 12);

  if (existingUser) {
    const isOwner = existingUser.role === "OWNER_MANAGER" || existingUser.role === "OWNER";
    const allowReset = process.env.RESET_EXISTING_OWNER === "true";

    if (isOwner && !allowReset) {
      console.log(`Owner account "${email}" already exists with role ${existingUser.role}. Existing password and active sessions are preserved.`);
      console.log("Notice: To intentionally reset this owner's password and revoke active sessions, rerun with RESET_EXISTING_OWNER=true.");
      await mongoose.connection.close();
      console.log("Database connection closed. No changes were made.");
      return;
    }

    console.log(`User with email "${email}" already exists (current role: ${existingUser.role}). Proceeding with authorized update.`);
    await usersCollection.updateOne(
      { _id: existingUser._id },
      {
        $set: {
          role: "OWNER_MANAGER",
          password: hashedPassword,
          isActive: true,
          refreshTokenHash: null,
          previousRefreshTokenHash: null,
          previousRefreshTokenExpiresAt: null,
          updatedAt: new Date(),
        },
      }
    );
    console.log(`Updated user "${email}" to role OWNER_MANAGER, reset password, and invalidated existing refresh tokens.`);
  } else {
    const newUser = {
      name,
      email,
      phone,
      password: hashedPassword,
      role: "OWNER_MANAGER",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await usersCollection.insertOne(newUser);
    console.log(`Successfully created OWNER_MANAGER user "${email}" (ID: ${result.insertedId}).`);
  }

  await mongoose.connection.close();
  console.log("Database connection closed. You can now log in at /login.");
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err.message);
  process.exit(1);
});
