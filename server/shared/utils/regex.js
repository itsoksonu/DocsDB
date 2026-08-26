// Escapes a user-supplied string so it can be embedded in a Mongo $regex as a
// literal. Without this, a pattern like ((a+)+)+$ makes mongod backtrack for
// minutes on a single request (ReDoS).
export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
