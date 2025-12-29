import { getServerSideSitemap } from "next-sitemap";
import axios from "axios";

export const getServerSideProps = async (ctx) => {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://docsdb.in";

  try {
    const response = await axios.get(`${apiUrl}/feed/sitemap-ids`);
    const documents = response.data.data;

    const fields = documents.map((doc) => ({
      loc: `${siteUrl}/document/${doc._id}`,
      lastmod: new Date(doc.updatedAt).toISOString(),
      priority: 0.7,
      changefreq: "weekly",
    }));

    return getServerSideSitemap(ctx, fields);
  } catch (error) {
    console.error("Error fetching sitemap data:", error);
    return getServerSideSitemap(ctx, []);
  }
};

export default function SiteMap() {}
