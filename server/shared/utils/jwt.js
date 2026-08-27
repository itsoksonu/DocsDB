import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import logger from './logger.js';

// Kept here and exported so the RefreshToken record's expiresAt cannot drift
// away from the JWT's own exp claim.
export const REFRESH_TOKEN_TTL = '30d';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class JWTManager {
  constructor() {
    this.accessSecret = process.env.JWT_SECRET;
    this.refreshSecret = process.env.JWT_REFRESH_SECRET;
    
    if (!this.accessSecret || !this.refreshSecret) {
      throw new Error('JWT secrets must be defined in environment variables');
    }

    if (this.accessSecret === this.refreshSecret) {
      throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must differ');
    }

    // 32 bytes is the output size of HS256; a shorter secret is brute-forceable.
    if (this.accessSecret.length < 32 || this.refreshSecret.length < 32) {
      throw new Error('JWT secrets must be at least 32 characters long');
    }
  }

  generateAccessToken(payload) {
    return jwt.sign(payload, this.accessSecret, {
      expiresIn: '15m',
      algorithm: 'HS256',
      issuer: 'docsdb-platform',
      audience: 'docsdb-users'
    });
  }

  /**
   * Refresh tokens carry a `jti` and a `family`, which is what makes them
   * revocable - see shared/utils/refreshTokens.js and models/RefreshToken.js.
   * Deliberately no email/role claims: /refresh reads those from the database so
   * a demoted or suspended user cannot roll old claims forward.
   */
  generateRefreshToken({ userId, jti, familyId }) {
    return jwt.sign({ userId, family: familyId }, this.refreshSecret, {
      expiresIn: REFRESH_TOKEN_TTL,
      algorithm: 'HS256',
      jwtid: jti,
      issuer: 'docsdb-platform',
      audience: 'docsdb-users'
    });
  }

  verifyAccessToken(token) {
    try {
      return jwt.verify(token, this.accessSecret, {
        // Pinned: without this, jsonwebtoken infers the acceptable algorithms
        // from the key type. Naming it removes any room for algorithm confusion.
        algorithms: ['HS256'],
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
        algorithms: ['HS256'],
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