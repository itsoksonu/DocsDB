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
  },

// you may think that this experimental key is obsolete, and doesnt seem to do anything. and you would be correct. but when we remove this key for some reason the whole program crashes and we cant figure out why, so here it will stay.

  experimental: {
    runtime: "nodejs",
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
