// api/geocode.js
// Vercel serverless function — proxies Nominatim geocoding server-side
// so User-Agent and rate limiting work correctly.
// Deploy this file at the root of your project as /api/geocode.js

export default async function handler(req, res) {
  // Allow CORS from your own domain
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://admin-avoid-capstone.vercel.app",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { address } = req.query;

  if (!address || typeof address !== "string" || address.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "Missing or invalid address parameter" });
  }

  const encoded = encodeURIComponent(address.trim());
  const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=ph`;

  try {
    const response = await fetch(url, {
      headers: {
        // Server-side fetch — User-Agent is NOT a forbidden header here
        "User-Agent": "AVOID-CapstoneApp/1.0 (admin-avoid-capstone.vercel.app)",
        Accept: "application/json",
        "Accept-Language": "en",
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        error: `Nominatim returned HTTP ${response.status}`,
      });
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      // No results — return nulls so ImportContext stores null gracefully
      return res.status(200).json({ lat: null, lng: null, found: false });
    }

    const { lat, lon } = data[0];
    return res.status(200).json({
      lat: parseFloat(lat),
      lng: parseFloat(lon),
      found: true,
    });
  } catch (err) {
    console.error("[geocode proxy] fetch error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
}
