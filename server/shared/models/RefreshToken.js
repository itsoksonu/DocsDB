import mongoose from "mongoose";

/**
 * One record per issued refresh token, so refresh tokens stop being purely
 * stateless and can actually be revoked.
 *
 * Why Mongo and not Redis: this is authentication state. Redis is treated as
 * optional throughout this codebase (getRedis() returns null and callers
 * degrade), so putting sessions there would mean either breaking every login
 * when Redis blips or silently failing open on revocation. Mongo is a hard
 * dependency already - connectMongo() exits the process on failure - and a TTL
 * index gives the same automatic expiry Redis would have.
 *
 * Records are marked used rather than deleted. That is what makes replay
 * detection possible: a deleted jti is indistinguishable from one that was never
 * issued, so a stolen-and-replayed token would look identical to a forged one.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    // The `jti` claim of the JWT. The token itself is never stored - only this
    // identifier - so a database leak does not hand out usable credentials.
    jti: {
      type: String,
      required: true,
      unique: true,
    },

    // All tokens descended from one login share a family. Detecting a replay
    // revokes the whole family, which logs out both the attacker and the
    // victim - the victim can log in again, the attacker cannot.
    familyId: {
      type: String,
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Set when the token is exchanged. Its presence is what marks a second
    // presentation as a replay.
    usedAt: Date,

    // jti of the token issued in its place, so a racing retry can be told apart
    // from a genuine replay.
    replacedBy: String,

    revokedAt: Date,
    revokedReason: String,

    // Recorded for incident review - which device/address a family came from.
    createdByIp: String,
    userAgent: String,

    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// Mongo removes documents once expiresAt passes, so expired records clean
// themselves up rather than accumulating for every login ever made.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

refreshTokenSchema.methods.isUsable = function () {
  return !this.usedAt && !this.revokedAt && this.expiresAt > new Date();
};

export default mongoose.model("RefreshToken", refreshTokenSchema);
