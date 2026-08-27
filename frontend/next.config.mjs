import withPWAInit from "@ducanh2912/next-pwa";

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
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);
