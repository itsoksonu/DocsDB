// This is a JSON API: it serves no HTML and no scripts, so the policy can be
// maximally restrictive. It is also sent unconditionally - gating it on
// NODE_ENV meant any deployment where the variable was unset shipped no CSP.
const API_CSP = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', API_CSP);

  // Only meaningful over TLS, and setting it on a plain-HTTP dev server would
  // pin localhost to https in the browser's HSTS store.
  if (req.secure || req.get('X-Forwarded-Proto') === 'https') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
};
