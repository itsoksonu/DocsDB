import withPWAInit from "@ducanh2912/next-pwa";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy, built from the environment rather than hardcoded,
 * because the API origin differs per deployment (NEXT_PUBLIC_API_URL is
 * http://localhost:3001/api/v1 locally and the real API in production).
 *
 * Every entry below corresponds to something this app actually loads - the list
 * was derived by grepping src/ for external origins, not guessed:
 *
 *   accounts.google.com   Google Sign-In: script, iframe, style and token calls
 *   fonts.googleapis.com  the Playfair Display stylesheet in _document.js
 *   fonts.gstatic.com     the font files that stylesheet references
 *   *.amazonaws.com       presigned S3 URLs, loaded as <img> and fetched by
 *                         useRawFile for the docx/xlsx/pptx viewers
 *   lh3.googleusercontent.com  Google profile pictures, stored as absolute URLs
 *   <api origin>          REST calls and the socket.io connection (ws/wss too)
 *
 * The motivating threat: pptx-preview bundles a version of echarts with an
 * unpatched XSS (GHSA-fgmj-fm8m-jvvx) and no fixed release exists, and it renders
 * attacker-supplied decks client-side. A CSP is the only mitigation available.
 */
function buildCsp() {
  // Origin only - NEXT_PUBLIC_API_URL carries a /api/v1 path that CSP would
  // otherwise treat as a path prefix.
  let apiOrigin = "";
  let apiSocket = "";
  try {
    const api = new URL(process.env.NEXT_PUBLIC_API_URL);
    apiOrigin = api.origin;
    apiSocket = `${api.protocol === "https:" ? "wss" : "ws"}://${api.host}`;
  } catch {
    // Unset or malformed: fall through with 'self' only. Reported at build time
    // by the warning below rather than silently producing a broken policy.
  }

  const google = "https://accounts.google.com";
  const s3 = "https://*.amazonaws.com";

  const directives = {
    "default-src": ["'self'"],

    // 'unsafe-inline' is required: Next's pages router injects inline bootstrap
    // and __NEXT_DATA__ scripts, and moving to nonces means a custom _document
    // plus middleware. 'unsafe-eval' is dev-only - webpack's eval source maps
    // need it, a production build does not.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      google,
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],

    // Inline styles come from framer-motion, docx-preview and Tailwind's
    // arbitrary values; Google Sign-In injects its own stylesheet.
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", google],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],

    // blob: covers canvas/pdf.js output; S3 for presigned thumbnails; Google for
    // OAuth profile pictures.
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      s3,
      "https://lh3.googleusercontent.com",
    ],

    "connect-src": [
      "'self'",
      s3,
      google,
      ...(apiOrigin ? [apiOrigin] : []),
      ...(apiSocket ? [apiSocket] : []),
      // Next's dev server talks to itself over a websocket for HMR.
      ...(isDev ? ["ws://localhost:3000", "http://localhost:3000"] : []),
    ],

    // pdf.js runs its worker from /pdf.worker.min.mjs, and may wrap it in a blob.
    "worker-src": ["'self'", "blob:"],
    "frame-src": [google],
    "manifest-src": ["'self'"],

    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

if (!process.env.NEXT_PUBLIC_API_URL) {
  console.warn(
    "[next.config] NEXT_PUBLIC_API_URL is not set - the CSP will not allow API calls."
  );
}

// Roll-out switch. Set CSP_REPORT_ONLY=true to have the browser report
// violations to the console without blocking anything, confirm the console is
// clean across sign-in / PDF view / office preview / upload, then unset it.
const cspHeaderName =
  process.env.CSP_REPORT_ONLY === "true"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  webpack: (config) => {
    // Required for react-pdf / pdfjs-dist to work with Next.js
    config.resolve.alias.canvas = false;

    // react-pdf does `import * as pdfjs from "pdfjs-dist"`, which resolves to
    // build/pdf.mjs. That file uses `import.meta`, and in development Next
    // wraps every module in eval() for source maps - where `import.meta` is
    // illegal. The module throws on its first line:
    //
    //   TypeError: Object.defineProperty called on non-object
    //     at __webpack_require__.r
    //     at ./node_modules/pdfjs-dist/build/pdf.mjs
    //
    // react-pdf, and then PDFViewer, fail to load with it, so the viewer sits
    // on next/dynamic's loading spinner for ever with no error rendered.
    // Setting `config.devtool` is not an option: Next reverts devtool changes
    // in development. The minified build does not trip the same path, so point
    // the bare specifier at it. Same version, same API, and less code shipped.
    //
    // Verified by compiling this import with Next's own bundled webpack: every
    // eval* devtool throws the above, every non-eval one loads, and the alias
    // loads under eval-source-map.
    config.resolve.alias["pdfjs-dist$"] =
      "pdfjs-dist/build/pdf.min.mjs";

    return config;
  },
  images: {
    domains: ["docsdb-upload.amazonaws.com"],
    // next/image is not used anywhere in this app (every image is a raw <img>),
    // but configuring `images` at all leaves the /_next/image optimizer route
    // live - and that endpoint is the target of most of the Next advisories that
    // still apply to 14.x: DoS via remotePatterns, cache confusion, unbounded
    // disk cache growth, content injection.
    //
    // With unoptimized:true, next-server.js render404s that route *before* it
    // validates params or fetches anything upstream, which closes the whole
    // class. If next/image is adopted later, remove this line - images will
    // otherwise be served at full size.
    unoptimized: true,
  },

  // DO NOT REMOVE esmExternals: false.
  //
  // This block previously also carried `runtime: "nodejs"`, with a note saying
  // removing it crashed the app. It was the wrong suspect: `runtime` was a Next
  // 12/13 option that no longer exists in 14 - it appears zero times in
  // next/dist/server/config-schema.js, nothing in next/dist reads it, and
  // `next build` printed "Unrecognized key(s) in object: 'runtime'" on every
  // build. It could not have been doing anything.
  //
  // `esmExternals: false` is the load-bearing one. It IS in the schema and is
  // read by next/dist/build/handle-externals.js, which decides how ESM packages
  // are externalized - i.e. exactly how pdfjs-dist and react-pdf get bundled,
  // the same interop the webpack alias above exists to work around. Deleting the
  // whole `experimental` block takes this with it, which is almost certainly
  // what broke production the last time.
  experimental: {
    esmExternals: false,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: cspHeaderName,
            value: buildCsp(),
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // X-XSS-Protection was removed rather than kept: it is a no-op in every
          // current browser, and in the old ones that did honour it the filter
          // could itself be abused to suppress legitimate script. The CSP above
          // is what actually provides this protection now.
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);
