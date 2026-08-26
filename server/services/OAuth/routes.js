import express from "express";
import { body, validationResult } from "express-validator";
import { OAuth2Client } from "google-auth-library";
import User from "../../shared/models/User.js";
import UserAuthProvider from "../../shared/models/UserAuthProvider.js";
import UserWallet from "../../shared/models/UserWallet.js";
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
  // Accepted for backwards compatibility with existing clients but ignored:
  // the provider id is read from the verified ID token, never from the body.
  body("providerId").optional(),
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

      const { provider, accessToken } = req.body;

      let verifiedUserInfo;

      try {
        if (provider === "google") {
          verifiedUserInfo = await verifyGoogleToken(accessToken);
        }
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: `Invalid ${provider} OAuth token`,
        });
      }

      // Identity comes from the verified ID token only. Trusting the
      // client-supplied email/providerId here would let anyone with their own
      // valid Google token link themselves to an arbitrary account.
      const actualProviderId = verifiedUserInfo.sub;
      const userEmail = verifiedUserInfo.email;
      const userName = verifiedUserInfo.name;
      const userAvatar = verifiedUserInfo.picture;

      const link = await UserAuthProvider.findByProvider(
        provider,
        actualProviderId
      );
      let user = link ? await User.findById(link.userId) : null;

      if (!user) {
        if (userEmail) {
          user = await User.findOne({ email: userEmail });
        }

        if (!user) {
          user = new User({
            email: userEmail,
            name: userName,
            avatar: userAvatar,
          });

          await user.save();
        }
      }

      await UserAuthProvider.connect(user._id, {
        provider,
        providerId: actualProviderId,
        accessToken,
        refreshToken: req.body.refreshToken || null,
      });

      user.lastLoginAt = new Date();
      await user.save();

      const wallet = await UserWallet.getOrCreate(user._id);

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
            kycStatus: wallet.kycStatus,
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

  // Without this check an unverified Google address could be used to claim an
  // existing DocsDB account that was created with the same email.
  if (payload.email_verified !== true) {
    throw new Error("Google account email is not verified");
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
    const links = await UserAuthProvider.find({ userId: req.user.userId })
      .select("provider connectedAt")
      .lean();

    const providers = links.map((link) => ({
      provider: link.provider,
      connectedAt: link.connectedAt,
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
