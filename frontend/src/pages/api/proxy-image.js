import axios from "axios";

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing URL" });
  }

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
    });

    res.setHeader("Content-Type", response.headers["content-type"]);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(response.data);
  } catch (error) {
    console.error("Error proxying image:", error);
    res.status(500).json({ error: "Failed to fetch image" });
  }
}
