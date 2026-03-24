/**
 * Frontend geocoding utilities
 * Handles both forward (address → lat/lng) and reverse (lat/lng → address) geocoding
 */

const GEOCODE_API_URL = "/api/geocode";

/**
 * Convert an address to latitude and longitude
 * @param {string} address - The address to geocode
 * @returns {Promise<{found: boolean, lat: ?number, lng: ?number, matchedQuery: ?string}>}
 */
export const geocodeAddress = async (address) => {
  if (!address || !address.trim()) {
    return { found: false, lat: null, lng: null, matchedQuery: null };
  }

  try {
    const params = new URLSearchParams({ address: address.trim() });
    const response = await fetch(`${GEOCODE_API_URL}?${params}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Geocoding error:", error);
    return { found: false, lat: null, lng: null, matchedQuery: null };
  }
};

/**
 * Convert latitude and longitude to an address (Reverse Geocoding)
 * @param {number} lat - Latitude coordinate
 * @param {number} lng - Longitude coordinate
 * @returns {Promise<{found: boolean, address: ?string, lat: number, lng: number}>}
 */
export const reverseGeocodeCoordinates = async (lat, lng) => {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return { found: false, address: null, lat: null, lng: null };
  }

  try {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const response = await fetch(`${GEOCODE_API_URL}?${params}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    return { found: false, address: null, lat, lng };
  }
};

/**
 * Batch reverse geocode multiple coordinate pairs
 * Useful for converting multiple flood incident locations to addresses
 * @param {Array<{lat: number, lng: number}>} coordinates - Array of coordinate pairs
 * @returns {Promise<Array<{lat: number, lng: number, address: ?string}>>}
 */
export const batchReverseGeocode = async (coordinates) => {
  if (!Array.isArray(coordinates) || !coordinates.length) {
    return [];
  }

  try {
    const results = await Promise.all(
      coordinates.map(async (coord) => {
        const { found, address } = await reverseGeocodeCoordinates(
          coord.lat,
          coord.lng,
        );
        return {
          lat: coord.lat,
          lng: coord.lng,
          address: found ? address : null,
        };
      }),
    );
    return results;
  } catch (error) {
    console.error("Batch reverse geocoding error:", error);
    return coordinates.map((coord) => ({
      lat: coord.lat,
      lng: coord.lng,
      address: null,
    }));
  }
};

/**
 * Cache for reverse geocoding results to avoid redundant API calls
 */
const geoCodingCache = new Map();

/**
 * Cached reverse geocoding with optional TTL
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} ttlMs - Time to live in milliseconds (default: 1 hour)
 * @returns {Promise<{found: boolean, address: ?string, lat: number, lng: number}>}
 */
export const cachedReverseGeocode = async (lat, lng, ttlMs = 3600000) => {
  const key = `${lat},${lng}`;

  // Check cache
  if (geoCodingCache.has(key)) {
    const cached = geoCodingCache.get(key);
    if (Date.now() - cached.timestamp < ttlMs) {
      return cached.data;
    }
    geoCodingCache.delete(key);
  }

  // Fetch from API
  const result = await reverseGeocodeCoordinates(lat, lng);

  // Store in cache
  geoCodingCache.set(key, { data: result, timestamp: Date.now() });

  return result;
};

/**
 * Clear the geocoding cache
 */
export const clearGeocachingCache = () => {
  geoCodingCache.clear();
};
