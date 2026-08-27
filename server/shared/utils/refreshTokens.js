// Refresh-token rotation with a revocable family and replay detection.
//
// The problem this solves: refresh tokens were stateless 30-day JWTs. /logout
// only cleared the cookie, so a stolen token stayed valid for the full 30 days,
// and because rotation left the old token working there was no way to tell a
// theft from normal use.
//
// The model is the standard rotating-family one:
//
//   * every login starts a family
//   * exchanging a token marks it used and issues a successor in the same family
//   * presenting an already-used token means two parties hold the same token, so
//     the entire family is revoked - the attacker is locked out, and the real
//     user simply logs in again
//
// See models/RefreshToken.js for why the store is Mongo rather than Redis.
import crypto from "crypto";

import RefreshToken from "../models/RefreshToken.js";
import JWTManager, { REFRESH_TOKEN_TTL_MS } from "./jwt.js";
import logger from "./logger.js";

/**
 * Two clients can legitimately refresh at nearly the same moment - a queued
 * request and the background timer, say - and the loser of that race presents a
 * token that was marked used milliseconds earlier. Treating that as theft would
 * log people out for being unlucky, so a reuse this recent is handled as a retry
 * instead. Long enough to cover a slow round trip, far too short to be useful to
 * an attacker who has to exfiltrate a token first.
 */
const REPLAY_GRACE_MS = 15 * 1000;

/**
 * One definition of the refresh cookie's flags, shared by every route that sets
 * or clears it. Kept together because clearCookie only removes a cookie when the
 * flags match the ones it was set with - drift here leaves users "logged out"
 * with a live cookie still in the jar.
 */
export function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  };
}

/** Distinguishable from an ordinary error so routes can answer 401 and log why. */
export class RefreshTokenError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "RefreshTokenError";
    this.reason = reason;
  }
}

/**
 * Mints a refresh token and records it.
 *
 * @param {object}  opts
 * @param {string}  opts.userId
 * @param {object}  [opts.req]       for recording ip / user-agent
 * @param {string}  [opts.familyId]  omit to start a new family (i.e. a new login)
 * @returns {Promise<{token: string, jti: string, familyId: string}>}
 */
export async function issueRefreshToken({ userId, req, familyId }) {
  const jti = crypto.randomUUID();
  const family = familyId || crypto.randomUUID();

  const token = JWTManager.generateRefreshToken({
    userId: String(userId),
    jti,
    familyId: family,
  });

  await RefreshToken.create({
    jti,
    familyId: family,
    userId,
    // Mirrors the JWT's own exp, and drives the TTL index that cleans the
    // collection up.
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    createdByIp: req?.ip,
    userAgent: req?.get?.("User-Agent"),
  });

  return { token, jti, familyId: family };
}

/** Revokes every unused token in a family. Idempotent. */
export async function revokeFamily(familyId, reason) {
  if (!familyId) return 0;

  const result = await RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );

  return result.modifiedCount ?? 0;
}

/**
 * Revokes every family belonging to a user - "sign out everywhere". Suitable for
 * a password/email change, an admin suspending an account, or a user-initiated
 * global logout.
 */
export async function revokeAllForUser(userId, reason) {
  if (!userId) return 0;

  const result = await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );

  return result.modifiedCount ?? 0;
}

/**
 * Verifies and consumes a presented refresh token, returning what the caller
 * needs to mint a successor.
 *
 * Throws RefreshTokenError on every rejection path; the caller should answer 401
 * without echoing the reason to the client.
 *
 * @returns {Promise<{userId: string, familyId: string, legacy: boolean}>}
 */
export async function consumeRefreshToken(presentedToken, req) {
  let decoded;
  try {
    decoded = JWTManager.verifyRefreshToken(presentedToken);
  } catch {
    throw new RefreshTokenError("invalid_signature", "Invalid refresh token");
  }

  // ---------------------------------------------------------------------
  // Migration path for tokens issued before rotation existed. Those have no
  // jti and no record, so rejecting them would sign out every logged-in user
  // the moment this deploys. They are accepted once and adopted into a new
  // family, which upgrades each session on its next refresh.
  //
  // Safe to delete this branch once the old 30-day tokens have all expired.
  // ---------------------------------------------------------------------
  if (!decoded.jti) {
    logger.info(
      `[refresh] adopting a pre-rotation token for user ${decoded.userId}`
    );
    return { userId: decoded.userId, familyId: null, legacy: true };
  }

  const record = await RefreshToken.findOne({ jti: decoded.jti });

  // Verified signature but no record: either it was revoked and swept by the
  // TTL index, or it was issued against a different database.
  if (!record) {
    throw new RefreshTokenError("unknown_jti", "Refresh token is not recognised");
  }

  if (record.revokedAt) {
    throw new RefreshTokenError("revoked", "Refresh token has been revoked");
  }

  if (record.expiresAt <= new Date()) {
    throw new RefreshTokenError("expired", "Refresh token has expired");
  }

  if (record.usedAt) {
    const age = Date.now() - record.usedAt.getTime();

    if (age <= REPLAY_GRACE_MS) {
      // A racing retry rather than a replay. Retire the successor the client
      // evidently never received, so the family keeps exactly one live token.
      if (record.replacedBy) {
        await RefreshToken.updateOne(
          { jti: record.replacedBy, usedAt: null },
          { $set: { revokedAt: new Date(), revokedReason: "superseded_by_retry" } }
        );
      }

      logger.warn(
        `[refresh] concurrent refresh for user ${record.userId} (${age}ms apart) - treating as retry`
      );
      return {
        userId: String(record.userId),
        familyId: record.familyId,
        legacy: false,
      };
    }

    // Two parties hold the same token. Kill the family, and record where the
    // replay came from - comparing this against the family's createdByIp is the
    // first thing worth knowing when investigating.
    const revoked = await revokeFamily(record.familyId, "replay_detected");
    logger.error(
      `[refresh] REPLAY DETECTED for user ${record.userId} - revoked ${revoked} token(s) in family ${record.familyId}`,
      {
        familyOriginIp: record.createdByIp,
        replayIp: req?.ip,
        replayUserAgent: req?.get?.("User-Agent"),
        tokenUsedAgoMs: age,
      }
    );
    throw new RefreshTokenError("replayed", "Refresh token has already been used");
  }

  // Claim the token. The usedAt:null filter makes this the atomic step: if two
  // requests arrive together, exactly one update matches and the other falls
  // into the grace-window branch above on its retry.
  const claimed = await RefreshToken.findOneAndUpdate(
    { jti: decoded.jti, usedAt: null, revokedAt: null },
    { $set: { usedAt: new Date() } },
    { new: true }
  );

  if (!claimed) {
    throw new RefreshTokenError(
      "race_lost",
      "Refresh token was consumed concurrently"
    );
  }

  return {
    userId: String(claimed.userId),
    familyId: claimed.familyId,
    legacy: false,
  };
}

/**
 * Consumes the presented token and issues its successor in the same family -
 * the whole rotation, so callers cannot accidentally do half of it.
 *
 * @returns {Promise<{userId: string, token: string, familyId: string}>}
 */
export async function rotateRefreshToken(presentedToken, req) {
  const { userId, familyId } = await consumeRefreshToken(presentedToken, req);

  const issued = await issueRefreshToken({ userId, req, familyId });

  // Link predecessor to successor so a retry can tell which token replaced it.
  if (familyId) {
    await RefreshToken.updateOne(
      { jti: JWTManager.decodeTokenWithoutVerification(presentedToken)?.jti },
      { $set: { replacedBy: issued.jti } }
    );
  }

  return { userId, token: issued.token, familyId: issued.familyId };
}
