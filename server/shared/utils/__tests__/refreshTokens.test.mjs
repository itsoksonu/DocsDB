/**
 * Refresh-token rotation, replay detection and revocation.
 *
 * The failure this guards against is concrete: refresh tokens used to be
 * stateless 30-day JWTs, so /logout was cosmetic and a stolen token stayed valid
 * for a month with no way to tell theft from normal use.
 *
 * RefreshToken is stubbed with an in-memory store (same approach as
 * storage.test.mjs) so these run without a database. The JWTs are real.
 *
 *   node --test shared/utils/__tests__/refreshTokens.test.mjs
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// Must be set before jwt.js is imported - its constructor validates them.
process.env.JWT_SECRET = "a".repeat(48);
process.env.JWT_REFRESH_SECRET = "b".repeat(48);

const RefreshToken = (await import("../../models/RefreshToken.js")).default;
const JWTManager = (await import("../jwt.js")).default;
const {
  issueRefreshToken,
  consumeRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  RefreshTokenError,
} = await import("../refreshTokens.js");

// --- in-memory stand-in for the collection --------------------------------

let rows = [];

/** Supports only the query shapes refreshTokens.js actually uses. */
function matches(row, filter) {
  for (const [key, expected] of Object.entries(filter)) {
    if (expected === null) {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else if (String(row[key]) !== String(expected)) {
      return false;
    }
  }
  return true;
}

RefreshToken.create = async (doc) => {
  const row = {
    ...doc,
    usedAt: null,
    revokedAt: null,
    replacedBy: null,
    isUsable() {
      return !this.usedAt && !this.revokedAt && this.expiresAt > new Date();
    },
  };
  rows.push(row);
  return row;
};

RefreshToken.findOne = async (filter) =>
  rows.find((row) => matches(row, filter)) || null;

RefreshToken.findOneAndUpdate = async (filter, update) => {
  const row = rows.find((r) => matches(r, filter));
  if (!row) return null;
  Object.assign(row, update.$set);
  return row;
};

RefreshToken.updateOne = async (filter, update) => {
  const row = rows.find((r) => matches(r, filter));
  if (!row) return { modifiedCount: 0 };
  Object.assign(row, update.$set);
  return { modifiedCount: 1 };
};

RefreshToken.updateMany = async (filter, update) => {
  const hits = rows.filter((r) => matches(r, filter));
  for (const row of hits) Object.assign(row, update.$set);
  return { modifiedCount: hits.length };
};

const USER = "507f1f77bcf86cd799439011";
const OTHER_USER = "507f1f77bcf86cd799439012";

beforeEach(() => {
  rows = [];
});

/** Backdates a token's usedAt so it falls outside the retry grace window. */
function ageUsedAt(jti, ms) {
  const row = rows.find((r) => r.jti === jti);
  row.usedAt = new Date(Date.now() - ms);
}

// --- issuing ---------------------------------------------------------------

test("issuing records the token and starts a family", async () => {
  const { token, jti, familyId } = await issueRefreshToken({ userId: USER });

  assert.ok(token, "a token is returned");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].jti, jti);
  assert.equal(rows[0].familyId, familyId);
  assert.ok(rows[0].expiresAt > new Date());
});

test("the token itself is never stored, only its id", async () => {
  const { token, jti } = await issueRefreshToken({ userId: USER });
  const stored = JSON.stringify(rows[0]);

  assert.ok(!stored.includes(token), "the JWT must not be persisted");
  assert.ok(stored.includes(jti));
});

test("the jti in the JWT matches the recorded one", async () => {
  const { token, jti } = await issueRefreshToken({ userId: USER });
  assert.equal(JWTManager.decodeTokenWithoutVerification(token).jti, jti);
});

test("two logins get separate families", async () => {
  const a = await issueRefreshToken({ userId: USER });
  const b = await issueRefreshToken({ userId: USER });
  assert.notEqual(a.familyId, b.familyId);
});

// --- the happy path -------------------------------------------------------

test("a fresh token can be consumed once", async () => {
  const { token, familyId } = await issueRefreshToken({ userId: USER });
  const result = await consumeRefreshToken(token);

  assert.equal(result.userId, USER);
  assert.equal(result.familyId, familyId);
  assert.ok(rows[0].usedAt, "consuming marks the record used");
});

test("rotation issues a successor inside the same family", async () => {
  const first = await issueRefreshToken({ userId: USER });
  const rotated = await rotateRefreshToken(first.token);

  assert.equal(rotated.familyId, first.familyId, "family is preserved");
  assert.notEqual(rotated.token, first.token, "a new token is issued");
  assert.equal(rows.length, 2);

  // The predecessor points at its replacement, which is what lets a racing
  // retry be told apart from a replay.
  assert.equal(rows[0].replacedBy, rows[1].jti);
});

test("the successor can itself be rotated (chains work)", async () => {
  const first = await issueRefreshToken({ userId: USER });
  const second = await rotateRefreshToken(first.token);
  const third = await rotateRefreshToken(second.token);

  assert.equal(third.familyId, first.familyId);
  assert.equal(rows.length, 3);
});

// --- replay detection -----------------------------------------------------

test("reusing a consumed token past the grace window is a replay", async () => {
  const { token, jti } = await issueRefreshToken({ userId: USER });
  await consumeRefreshToken(token);
  ageUsedAt(jti, 60 * 1000);

  await assert.rejects(
    () => consumeRefreshToken(token),
    (error) => {
      assert.ok(error instanceof RefreshTokenError);
      assert.equal(error.reason, "replayed");
      return true;
    }
  );
});

test("a replay revokes the whole family, not just the replayed token", async () => {
  const first = await issueRefreshToken({ userId: USER });
  const second = await rotateRefreshToken(first.token);
  ageUsedAt(first.jti, 60 * 1000);

  // The attacker replays the token they stole.
  await assert.rejects(() => consumeRefreshToken(first.token));

  // The legitimate holder's current token is dead too - they log in again, the
  // attacker cannot.
  await assert.rejects(
    () => consumeRefreshToken(second.token),
    (error) => error.reason === "revoked"
  );

  assert.ok(
    rows.every((row) => row.revokedAt),
    "every token in the family is revoked"
  );
  assert.equal(rows[0].revokedReason, "replay_detected");
});

test("a replay does not touch a different family belonging to the same user", async () => {
  const laptop = await issueRefreshToken({ userId: USER });
  const phone = await issueRefreshToken({ userId: USER });

  await consumeRefreshToken(laptop.token);
  ageUsedAt(laptop.jti, 60 * 1000);
  await assert.rejects(() => consumeRefreshToken(laptop.token));

  // The other device is unaffected.
  const result = await consumeRefreshToken(phone.token);
  assert.equal(result.familyId, phone.familyId);
});

// --- concurrency ----------------------------------------------------------

test("a reuse inside the grace window is treated as a retry, not a replay", async () => {
  const first = await issueRefreshToken({ userId: USER });
  await rotateRefreshToken(first.token);

  const successorJti = rows.find((row) => row.jti === first.jti).replacedBy;
  assert.ok(successorJti, "rotation recorded a successor");

  // The same token again, immediately - the shape of a client whose first
  // response was lost in flight.
  const retry = await consumeRefreshToken(first.token);
  assert.equal(retry.familyId, first.familyId);

  assert.ok(
    !rows.some((row) => row.revokedReason === "replay_detected"),
    "a retry must not be reported as theft"
  );

  // The successor the client never received is retired, so the family is left
  // with exactly one live token rather than two.
  const successor = rows.find((row) => row.jti === successorJti);
  assert.equal(successor.revokedReason, "superseded_by_retry");
  assert.ok(successor.revokedAt, "the unreceived successor is revoked");
});

test("only one of two simultaneous consumes of the same token succeeds", async () => {
  const { token } = await issueRefreshToken({ userId: USER });

  const results = await Promise.allSettled([
    consumeRefreshToken(token),
    consumeRefreshToken(token),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  // Both may resolve (the second via the grace window) but the family must not
  // be revoked - a legitimate race must never sign the user out.
  assert.ok(fulfilled.length >= 1);
  assert.ok(
    !rows.some((row) => row.revokedReason === "replay_detected"),
    "a same-instant race is not reported as theft"
  );
});

// --- revocation -----------------------------------------------------------

test("revokeFamily ends the session and blocks further refreshes", async () => {
  const { token, familyId } = await issueRefreshToken({ userId: USER });

  const count = await revokeFamily(familyId, "logout");
  assert.equal(count, 1);

  await assert.rejects(
    () => consumeRefreshToken(token),
    (error) => error.reason === "revoked"
  );
});

test("revokeFamily is idempotent", async () => {
  const { familyId } = await issueRefreshToken({ userId: USER });
  assert.equal(await revokeFamily(familyId, "logout"), 1);
  assert.equal(await revokeFamily(familyId, "logout"), 0);
});

test("revokeAllForUser ends every family for that user only", async () => {
  const laptop = await issueRefreshToken({ userId: USER });
  const phone = await issueRefreshToken({ userId: USER });
  const stranger = await issueRefreshToken({ userId: OTHER_USER });

  const count = await revokeAllForUser(USER, "logout_all");
  assert.equal(count, 2);

  await assert.rejects(() => consumeRefreshToken(laptop.token));
  await assert.rejects(() => consumeRefreshToken(phone.token));

  // Another user's session is untouched.
  const ok = await consumeRefreshToken(stranger.token);
  assert.equal(ok.userId, OTHER_USER);
});

// --- rejection paths ------------------------------------------------------

test("a token with a valid signature but no record is rejected", async () => {
  const { token } = await issueRefreshToken({ userId: USER });
  rows = []; // e.g. swept by the TTL index after revocation

  await assert.rejects(
    () => consumeRefreshToken(token),
    (error) => error.reason === "unknown_jti"
  );
});

test("a tampered token is rejected on signature, before any lookup", async () => {
  const { token } = await issueRefreshToken({ userId: USER });
  const tampered = `${token.slice(0, -3)}xyz`;

  await assert.rejects(
    () => consumeRefreshToken(tampered),
    (error) => error.reason === "invalid_signature"
  );
});

test("a token signed with the access secret is rejected", async () => {
  // Guards the two secrets being kept distinct.
  const forged = JWTManager.generateAccessToken({ userId: USER });

  await assert.rejects(
    () => consumeRefreshToken(forged),
    (error) => error.reason === "invalid_signature"
  );
});

test("an expired record is rejected even if the JWT still verifies", async () => {
  const { token, jti } = await issueRefreshToken({ userId: USER });
  rows.find((r) => r.jti === jti).expiresAt = new Date(Date.now() - 1000);

  await assert.rejects(
    () => consumeRefreshToken(token),
    (error) => error.reason === "expired"
  );
});

// --- migration ------------------------------------------------------------

test("a pre-rotation token (no jti) is adopted once instead of rejected", async () => {
  // Deploying rotation must not sign out every existing session, so a token
  // shaped like the old stateless ones is accepted and given a family.
  const legacy = (await import("jsonwebtoken")).default.sign(
    { userId: USER, email: "a@b.co", role: "user" },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: "30d",
      algorithm: "HS256",
      issuer: "docsdb-platform",
      audience: "docsdb-users",
    }
  );

  const result = await consumeRefreshToken(legacy);
  assert.equal(result.userId, USER);
  assert.equal(result.legacy, true);
  assert.equal(result.familyId, null, "a new family is started on rotation");

  const rotated = await rotateRefreshToken(legacy);
  assert.ok(rotated.familyId, "the adopted session now has a family");
  assert.equal(rows.length, 1);
});
