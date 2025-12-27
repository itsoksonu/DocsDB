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
    if (avatar) updates.avatar = avatar;

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
router.post("/logout", authMiddleware, (req, res) => {
  res.clearCookie("refreshToken");
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
    if (userObj.avatar && !userObj.avatar.startsWith("http")) {
      try {
        userObj.avatar = await s3.generateViewUrl(userObj.avatar);
      } catch (error) {
        console.error("Error generating avatar URL:", error);
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
