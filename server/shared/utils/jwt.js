import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import logger from './logger.js';

class JWTManager {
  constructor() {
    this.accessSecret = process.env.JWT_SECRET;
    this.refreshSecret = process.env.JWT_REFRESH_SECRET;
    
    if (!this.accessSecret || !this.refreshSecret) {
      throw new Error('JWT secrets must be defined in environment variables');
    }
  }

  generateAccessToken(payload) {
    return jwt.sign(payload, this.accessSecret, {
      expiresIn: '15m',
      issuer: 'docsdb-platform',
      audience: 'docsdb-users'
    });
  }

  generateRefreshToken(payload) {
    return jwt.sign(payload, this.refreshSecret, {
      expiresIn: '30d',
      issuer: 'docsdb-platform',
      audience: 'docsdb-users'
    });
  }

  verifyAccessToken(token) {
    try {
      return jwt.verify(token, this.accessSecret, {
        issuer: 'docsdb-platform',
        audience: 'docsdb-users'
      });
    } catch (error) {
      logger.warn('Access token verification failed:', error.message);
      throw new Error('Invalid or expired access token');
    }
  }

  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, this.refreshSecret, {
        issuer: 'docsdb-platform',
        audience: 'docsdb-users'
      });
    } catch (error) {
      logger.warn('Refresh token verification failed:', error.message);
      throw new Error('Invalid or expired refresh token');
    }
  }

  generateFingerprint(req) {
    const components = [
      req.ip,
      req.headers['user-agent'],
      req.headers['accept-language']
    ].filter(Boolean).join('|');
    
    return crypto.createHash('sha256').update(components).digest('hex');
  }

  decodeTokenWithoutVerification(token) {
    return jwt.decode(token);
  }
}

export default new JWTManager();