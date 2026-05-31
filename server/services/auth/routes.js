import express from "express";
import User from "../../shared/models/User.js";
import Document from "../../shared/models/Document.js";
import JWTManager from "../../shared/utils/jwt.js";
import { authMiddleware } from "../middleware/auth.js";
import s3 from "../../shared/utils/s3.js";

const router = express.Router();

// Update user profile
router.patch("/me", authMiddleware, async (req, res, next) => {
  try {
    const { name, avatar } = req.body;
    const userId = req.user.userId;

    const updates = {};
    if (name) updates.name = name.trim();

    // Only update avatar if it's a key (not a full URL)
    if (avatar && !avatar.startsWith("http")) {
      updates.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userObj = user.toObject();

    // Generate signed URL for avatar if needed
    if (userObj.avatar && !userObj.avatar.startsWith("http")) {
      try {
        userObj.avatar = await s3.generateViewUrl(userObj.avatar);
      } catch (error) {
        console.error("Error generating avatar URL:", error);
      }
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: { user: userObj },
    });
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    const decoded = JWTManager.verifyRefreshToken(refreshToken);

    const tokenPayload = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    const newAccessToken = JWTManager.generateAccessToken(tokenPayload);
    const newRefreshToken = JWTManager.generateRefreshToken(tokenPayload);

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.json({
      success: true,
      message: "Token refreshed successfully",
      data: {
        accessToken: newAccessToken,
        expiresIn: "15m",
      },
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid refresh token",
    });
  }
});

// Logout
router.post("/logout", (req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
  res.json({
    success: true,
    message: "Logout successful",
  });
});

// Get current user profile
router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const uploadedCount = await Document.countDocuments({
      userId: req.user.userId,
      status: { $ne: "deleted" },
    });

    const userObj = user.toObject();

    // Generate signed URL for avatar if it exists and is an S3 key
    // Fix broken avatars (lazy migration) and generate signed URL
    if (userObj.avatar) {
      // Check if avatar is mistakenly stored as a full S3 URL
      if (
        userObj.avatar.includes("amazonaws.com") &&
        userObj.avatar.startsWith("http")
      ) {
        try {
          // Extract key from URL
          // Format usually: https://bucket.s3.region.amazonaws.com/key?params
          const urlObj = new URL(userObj.avatar);
          const path = urlObj.pathname; // /key
          const key = path.startsWith("/") ? path.slice(1) : path;

          // Verify it looks like a file key (e.g. avatars/...)
          if (key && !key.includes("amazonaws.com")) {
            // Update DB asynchronously to fix the corruption
            await User.findByIdAndUpdate(user._id, { avatar: key });
            userObj.avatar = key; // Use the fixed key for generating new URL
          }
        } catch (e) {
          console.error("Error parsing stale avatar URL:", e);
        }
      }

      // Generate signed URL if we have a key (not a URL)
      if (!userObj.avatar.startsWith("http")) {
        try {
          userObj.avatar = await s3.generateViewUrl(userObj.avatar);
        } catch (error) {
          console.error("Error generating avatar URL:", error);
        }
      }
    }

    res.json({
      success: true,
      data: {
        user: {
          ...userObj,
          uploadedCount,
          savedCount: user.savedDocuments.length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
