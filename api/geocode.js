// api/geocode.js — Vercel serverless function
// Uses OpenCage Geocoding API (free tier, no credit card, good PH coverage)

export default async function handler(req, res) {
  const { address, lat, lng } = req.query;

  // Handle reverse geocoding (lat/lng to address)
  if (lat !== undefined && lng !== undefined) {
    return handleReverseGeocoding(req, res, lat, lng);
  }

  // Handle forward geocoding (address to lat/lng)
  if (!address || !address.trim()) {
    return res
      .status(400)
      .json({ found: false, error: "No address or coordinates provided" });
  }

  const apiKey = process.env.OPENCAGE_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ found: false, error: "OPENCAGE_API_KEY not configured" });
  }

  const trimmed = address.trim();

  // Build a list of search queries from most specific → least specific
  const queries = buildFallbackQueries(trimmed);

  for (const query of queries) {
    const result = await tryOpenCage(query, apiKey);
    if (result) {
      return res.status(200).json({
        found: true,
        lat: result.lat,
        lng: result.lng,
        matchedQuery: query,
      });
    }
  }

  return res.status(200).json({ found: false, lat: null, lng: null });
}

// ── Reverse Geocoding (Coordinates to Address) ──────────────────────────────

async function handleReverseGeocoding(req, res, lat, lng) {
  const apiKey = process.env.OPENCAGE_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ found: false, error: "OPENCAGE_API_KEY not configured" });
  }

  try {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (!isFinite(latNum) || !isFinite(lngNum)) {
      return res
        .status(400)
        .json({ found: false, error: "Invalid coordinates" });
    }

    const encoded = encodeURIComponent(`${latNum},${lngNum}`);
    const url = `https://api.opencagedata.com/geocode/v1/json?q=${encoded}&key=${apiKey}&countrycode=ph&limit=1&no_annotations=1`;

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(200).json({ found: false, address: null });
    }

    const data = await response.json();

    if (!data.results?.length) {
      return res.status(200).json({ found: false, address: null });
    }

    const formatted = data.results[0].formatted || null;
    return res
      .status(200)
      .json({ found: true, address: formatted, lat: latNum, lng: lngNum });
  } catch {
    return res.status(200).json({ found: false, address: null });
  }
}

// ── Build progressive fallback queries ──────────────────────────────────────

function buildFallbackQueries(address) {
  const queries = [];

  // 1. Full address + Philippines
  const withPH = address.toLowerCase().includes("philippines")
    ? address
    : `${address}, Philippines`;
  queries.push(withPH);

  // 2. Normalize "Brgy" → "Barangay"
  const withBarangay = withPH.replace(/\bBrgy\.?\b/gi, "Barangay");
  if (withBarangay !== withPH) queries.push(withBarangay);

  // 3. Strip house/lot number prefix (e.g. "42 Rosal Street" → "Rosal Street")
  const noHouseNum = withPH.replace(/^\d+[\-\d]*\s+/, "");
  if (noHouseNum !== withPH) {
    queries.push(noHouseNum);
    queries.push(noHouseNum.replace(/\bBrgy\.?\b/gi, "Barangay"));
  }

  // 4. Just barangay + city (drop the street entirely)
  const brgyMatch = address.match(/\b(?:Brgy\.?|Barangay)\s+([^,]+),\s*(.+)/i);
  if (brgyMatch) {
    const brgy = brgyMatch[1].trim();
    const city = brgyMatch[2].trim().replace(/,?\s*philippines$/i, "");
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

// ── Call OpenCage ────────────────────────────────────────────────────────────

async function tryOpenCage(query, apiKey) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://api.opencagedata.com/geocode/v1/json?q=${encoded}&key=${apiKey}&countrycode=ph&limit=1&no_annotations=1`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();

    if (!data.results?.length) return null;

    const lat = parseFloat(data.results[0].geometry.lat);
    const lng = parseFloat(data.results[0].geometry.lng);

    if (!isFinite(lat) || !isFinite(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}
