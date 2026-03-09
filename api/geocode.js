// api/geocode.js — Vercel serverless function
// Progressive fallback for Philippine barangay-level addresses

export default async function handler(req, res) {
  const { address } = req.query;

  if (!address || !address.trim()) {
    return res.status(400).json({ found: false, error: "No address provided" });
  }

  const trimmed = address.trim();

  // Build a list of search queries from most specific → least specific
  // e.g. "42 Rosal Street, Brgy Cupang, Antipolo City"
  // → try full, then without house number, then city only
  const queries = buildFallbackQueries(trimmed);

  for (const query of queries) {
    const result = await tryNominatim(query);
    if (result) {
      return res
        .status(200)
        .json({
          found: true,
          lat: result.lat,
          lng: result.lng,
          matchedQuery: query,
        });
    }
    // Small delay between attempts to respect Nominatim rate limit
    await sleep(300);
  }

  return res.status(200).json({ found: false, lat: null, lng: null });
}

// ── Build progressive fallback queries ──────────────────────────────────────

function buildFallbackQueries(address) {
  const queries = [];

  // 1. Full address as-is
  queries.push(address);

  // 2. Normalize "Brgy" → "Barangay" (Nominatim sometimes handles it better)
  const withBarangay = address.replace(/\bBrgy\.?\b/gi, "Barangay");
  if (withBarangay !== address) queries.push(withBarangay);

  // 3. Strip house/lot number prefix (e.g. "42 Rosal Street" → "Rosal Street")
  const noHouseNum = address.replace(/^\d+[\-\d]*\s+/, "");
  if (noHouseNum !== address) {
    queries.push(noHouseNum);
    queries.push(noHouseNum.replace(/\bBrgy\.?\b/gi, "Barangay"));
  }

  // 4. Just barangay + city (drop the street entirely)
  // Matches patterns like "Brgy Cupang, Antipolo City" or "Barangay Cupang, Antipolo"
  const brgyMatch = address.match(/\b(?:Brgy\.?|Barangay)\s+([^,]+),\s*(.+)/i);
  if (brgyMatch) {
    const brgy = brgyMatch[1].trim();
    const city = brgyMatch[2].trim();
    queries.push(`Barangay ${brgy}, ${city}, Philippines`);
    queries.push(`${brgy}, ${city}, Philippines`);
  }

  // 5. City/municipality only as last resort
  const cityMatch = address.match(
    /([^,]+(?:City|Municipality|Quezon City|Manila)[^,]*)/i,
  );
  if (cityMatch) {
    queries.push(`${cityMatch[1].trim()}, Philippines`);
  }

  // Deduplicate while preserving order
  return [...new Set(queries)];
}

// ── Call Nominatim ───────────────────────────────────────────────────────────

async function tryNominatim(query) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=1&countrycodes=ph`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "AVOID-Delivery-App/1.0 (capstone project; contact@avoid.app)",
        "Accept-Language": "en",
        Referer: "https://admin-avoid-capstone.vercel.app",
      },
    });

    if (!response.ok) return null;

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return null;

    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);

    if (!isFinite(lat) || !isFinite(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
