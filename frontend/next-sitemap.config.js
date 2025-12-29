/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://docsdb.in",
  generateRobotsTxt: true,
  exclude: ["/server-sitemap.xml"],
  robotsTxtOptions: {
    additionalSitemaps: [
      `${
        process.env.NEXT_PUBLIC_SITE_URL || "https://docsdb.in"
      }/server-sitemap.xml`,
    ],
  },
};
