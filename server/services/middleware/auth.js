import JWTManager from "../../shared/utils/jwt.js";
import User from "../../shared/models/User.js";

export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access token required",
      });
    }

    const token = authHeader.substring(7);
    const decoded = JWTManager.verifyAccessToken(token);

    const user = await User.findById(decoded.userId).select("email role status");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Account is not active",
      });
    }

    // Role comes from the freshly loaded user, not from the token claims - a
    // demoted admin must lose access immediately rather than at token expiry.
    req.user = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired access token",
    });
  }
};

export const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // If no token, proceed without user
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.substring(7);

    try {
      const decoded = JWTManager.verifyAccessToken(token);
      const user = await User.findById(decoded.userId).select(
        "email role status"
      );

      if (user && user.status === "active") {
        req.user = {
          userId: user._id.toString(),
          email: user.email,
          role: user.role,
        };
      }
    } catch (err) {
      // Optional auth: an expired or invalid token must not break a public
      // route. Continue unauthenticated and let the route decide.
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    next();
  };
};
