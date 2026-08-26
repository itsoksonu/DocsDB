// ESM, not module.exports: package.json declares "type": "module", so a .js file
// here is an ES module and `module` is not defined. next-sitemap loads this via
// dynamic import(), so a default export is what it expects.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://docsdb.in";

/** @type {import('next-sitemap').IConfig} */
const config = {
  siteUrl,
  generateRobotsTxt: true,
  exclude: ["/server-sitemap.xml"],
  robotsTxtOptions: {
    additionalSitemaps: [`${siteUrl}/server-sitemap.xml`],
  },
};

export default config;
