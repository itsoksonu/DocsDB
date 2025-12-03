import express from 'express';
import User from '../../shared/models/User.js';
import JWTManager from '../../shared/utils/jwt.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    const decoded = JWTManager.verifyRefreshToken(refreshToken);
    
    const tokenPayload = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role
    };

    const newAccessToken = JWTManager.generateAccessToken(tokenPayload);
    const newRefreshToken = JWTManager.generateRefreshToken(tokenPayload);

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        expiresIn: '15m'
      }
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
});

// Logout
router.post('/logout', authMiddleware, (req, res) => {
  res.clearCookie('refreshToken');
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

// Get current user profile
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    next(error);
  }
});

export default router;