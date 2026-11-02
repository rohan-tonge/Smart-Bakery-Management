import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { USER_ROLES } from "../utils/constants.js";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters long"],
      maxlength: [60, "Name cannot exceed 60 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
      select: false, // Never return password in queries by default
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    jobDesignation: { type: String, trim: true, maxlength: 80, default: "" },
    skills: { type: [String], default: [] },
    hourlyLabourRate: { type: Number, min: 0, default: null },
    role: {
      type: String,
      enum: {
        values: [
          USER_ROLES.CUSTOMER,
          USER_ROLES.OWNER_MANAGER,
          USER_ROLES.PRODUCTION_STAFF,
          "OWNER",
          "MANAGER",
        ],
        message: "{VALUE} is not a valid role",
      },
      default: USER_ROLES.CUSTOMER,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    refreshTokenHash: {
      type: String,
      select: false, // Never return refresh token hash in normal queries
      default: null,
    },
    previousRefreshTokenHash: {
      type: String,
      select: false,
      default: null,
    },
    previousRefreshTokenExpiresAt: {
      type: Date,
      select: false,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.refreshTokenHash;
        delete ret.previousRefreshTokenHash;
        delete ret.previousRefreshTokenExpiresAt;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.refreshTokenHash;
        delete ret.previousRefreshTokenHash;
        delete ret.previousRefreshTokenExpiresAt;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Index for role queries
userSchema.index({ role: 1 });

// Pre-save hook: Hash password if modified
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Instance method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    throw new Error("Password field is not selected on user document");
  }
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model("User", userSchema);
export default User;
