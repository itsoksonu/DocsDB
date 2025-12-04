import express from "express";
import { body, validationResult } from "express-validator";
import { OAuth2Client } from "google-auth-library";
import User from "../../shared/models/User.js";
import JWTManager from "../../shared/utils/jwt.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";

const router = express.Router();

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const oauthValidation = [
  body("provider")
    .equals("google")
    .withMessage("Only Google OAuth is supported"),
  body("accessToken").notEmpty(),
  body("providerId").notEmpty(),
];

router.post(
  "/",
  oauthValidation,
  rateLimitMiddleware("auth"),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { provider, accessToken, providerId, email, name, avatar } =
        req.body;

      let verifiedUserInfo;
      let actualProviderId = providerId;

      try {
        if (provider === "google") {
          verifiedUserInfo = await verifyGoogleToken(accessToken);
          actualProviderId = verifiedUserInfo.sub;
        }
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: `Invalid ${provider} OAuth token`,
        });
      }

      const userEmail = email || verifiedUserInfo?.email;
      const userName = name || verifiedUserInfo?.name;
      const userAvatar = avatar || verifiedUserInfo?.picture;

      let user = await User.findByOAuthProvider(provider, actualProviderId);

      if (!user) {
        if (userEmail) {
          user = await User.findOne({ email: userEmail });
        }

        if (user) {
          await user.addAuthProvider({
            provider,
            providerId: actualProviderId,
            accessToken,
            refreshToken: null,
          });
        } else {
          user = new User({
            email: userEmail,
            name: userName,
            avatar: userAvatar,
            authProviders: [
              {
                provider,
                providerId: actualProviderId,
                accessToken,
                refreshToken: null,
              },
            ],
          });

          await user.save();
        }
      } else {
        await user.addAuthProvider({
          provider,
          providerId: actualProviderId,
          accessToken,
          refreshToken: req.body.refreshToken,
        });
      }

      user.lastLoginAt = new Date();
      await user.save();

      const tokenPayload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
      };

      const accessTokenJWT = JWTManager.generateAccessToken(tokenPayload);
      const refreshTokenJWT = JWTManager.generateRefreshToken(tokenPayload);

      res.cookie("refreshToken", refreshTokenJWT, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      res.json({
        success: true,
        message: "OAuth login successful",
        data: {
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            kycStatus: user.kycStatus,
            avatar: user.avatar,
          },
          accessToken: accessTokenJWT,
          expiresIn: "15m",
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

async function verifyGoogleToken(accessToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken: accessToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload) {
    throw new Error("Invalid Google token");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
}

router.get("/providers", authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId).select("authProviders");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const providers = user.authProviders.map((provider) => ({
      provider: provider.provider,
      connectedAt: provider.connectedAt,
    }));

    res.json({
      success: true,
      data: { providers },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
