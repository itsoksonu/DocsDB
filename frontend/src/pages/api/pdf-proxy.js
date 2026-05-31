import axios from "axios";

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing URL" });
  }

  // Only allow S3 URLs to prevent this proxy being used for arbitrary requests
  if (!url.includes("amazonaws.com")) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 60000,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=3600");

    response.data.pipe(res);
  } catch (error) {
    console.error("Error proxying PDF:", error.message);
    res.status(500).json({ error: "Failed to fetch PDF" });
  }
}
