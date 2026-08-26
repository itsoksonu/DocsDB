import express from "express";
import User from "../../shared/models/User.js";
import Document from "../../shared/models/Document.js";
import SavedDocument from "../../shared/models/SavedDocument.js";
import JWTManager from "../../shared/utils/jwt.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import s3 from "../../shared/utils/s3.js";

const router = express.Router();

// Avatar keys are minted by S3Manager.generateFileKey as
// `avatars/<userId>/<timestamp>-<uuid>.<ext>` - see services/upload/routes.js.
function isOwnAvatarKey(key, userId) {
  return new RegExp(`^avatars/${userId}/[\\w.-]+$`).test(key);
}

// Update user profile
router.patch("/me", authMiddleware, async (req, res, next) => {
  try {
    const { name, avatar } = req.body;
    const userId = req.user.userId;

    const updates = {};
    if (name) updates.name = name.trim();

    // Only accept an S3 key inside this user's own avatar prefix. Accepting any
    // key would let a caller point their avatar at another tenant's object and
    // read it back through the signed URL generated below.
    if (avatar !== undefined) {
      if (typeof avatar !== "string" || !isOwnAvatarKey(avatar, userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid avatar key",
        });
      }
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
router.post("/refresh", rateLimitMiddleware("auth"), async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    const decoded = JWTManager.verifyRefreshToken(refreshToken);

    // Rebuild the claims from the database rather than copying them out of the
    // presented token: otherwise a demoted, suspended or deleted user keeps
    // their original role for the whole 30-day refresh window by rolling the
    // token forward.
    const user = await User.findById(decoded.userId).select("email role status");

    if (!user || user.status !== "active") {
      return res.status(401).json({
        success: false,
        message: "Account is no longer active",
      });
    }

    const tokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
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

    const [uploadedCount, savedCount] = await Promise.all([
      Document.countDocuments({
        userId: req.user.userId,
        status: { $ne: "deleted" },
      }),
      SavedDocument.countDocuments({ userId: req.user.userId }),
    ]);

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
          savedCount,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
