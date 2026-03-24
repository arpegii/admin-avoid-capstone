/**
 * Flood Analytics Utilities
 * Generates analytics for riders affected by flood zones
 */

import { cachedReverseGeocode } from "./geocoding";

/**
 * Build flood analytics from riders and flood incident data
 * @param {Array} riders - Array of rider objects
 * @param {Array} floodIncidents - Array of flood incident data
 * @returns {Promise<Object>} Flood analytics object with charts and summary
 */
export const buildFloodAnalytics = async (riders = [], floodIncidents = []) => {
  if (!Array.isArray(floodIncidents) || floodIncidents.length === 0) {
    return {
      summary: [
        ["Flood Incidents Detected", "0"],
        ["Affected Riders", "0"],
        ["Highest Risk Area", "N/A"],
      ],
      charts: [],
    };
  }

  // Count flood incidents by rider
  const floodByRider = {};
  const floodLocations = new Set();

  floodIncidents.forEach((incident) => {
    const riderName = incident.rider_name || "Unknown";
    floodByRider[riderName] = (floodByRider[riderName] || 0) + 1;

    if (incident.location) {
      floodLocations.add(incident.location);
    }
  });

  // Get top affected riders
  const topAffectedRiders = Object.entries(floodByRider)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  // Build flood incidents by date (monthly)
  const monthlyFloods = {};
  floodIncidents.forEach((incident) => {
    const dateStr = incident.created_at || incident.date;
    if (!dateStr) return;

    const date = new Date(dateStr);
    const monthKey = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
    });

    monthlyFloods[monthKey] = (monthlyFloods[monthKey] || 0) + 1;
  });

  // Get addresses for top affected locations
  const locationAddresses = {};
  const uniqueLocations = [...floodLocations].slice(0, 5);

  for (const location of uniqueLocations) {
    const parts = location.split(",");
    if (parts.length >= 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);

      if (!isNaN(lat) && !isNaN(lng)) {
        try {
          const { found, address } = await cachedReverseGeocode(lat, lng);
          if (found && address) {
            locationAddresses[location] = address;
          }
        } catch {
          // Silently fail, use original location
        }
      }
    }
  }

  return {
    summary: [
      ["Flood Incidents", String(floodIncidents.length)],
      ["Affected Riders", String(Object.keys(floodByRider).length)],
      ["High-Risk Areas", String(floodLocations.size)],
    ],
    charts: [
      {
        title: "Flood Incidents by Rider",
        datasetLabel: "Incidents",
        labels: topAffectedRiders.map(([name]) => name),
        values: topAffectedRiders.map(([, count]) => count),
      },
      {
        title: "Flood Events Over Time",
        datasetLabel: "Events",
        labels: Object.keys(monthlyFloods),
        values: Object.values(monthlyFloods),
      },
    ],
  };
};

/**
 * Filter flood incidents within a date range
 * @param {Array} incidents - Array of flood incidents
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Array} Filtered incidents
 */
export const filterFloodIncidentsByDate = (
  incidents = [],
  startDate,
  endDate,
) => {
  return incidents.filter((incident) => {
    const dateStr = incident.created_at || incident.date;
    if (!dateStr) return false;

    const incidentDate = new Date(dateStr);
    const afterStart =
      !startDate || incidentDate >= new Date(`${startDate}T00:00:00`);
    const beforeEnd =
      !endDate || incidentDate <= new Date(`${endDate}T23:59:59`);

    return afterStart && beforeEnd;
  });
};

/**
 * Get flood incident statistics
 * @param {Array} incidents - Array of flood incidents
 * @returns {Object} Statistics object
 */
export const getFloodStatistics = (incidents = []) => {
  if (!incidents.length) {
    return {
      total: 0,
      uniqueRiders: 0,
      uniqueLocations: 0,
      dateRange: null,
    };
  }

  const uniqueRiders = new Set(incidents.map((i) => i.rider_name || "Unknown"));
  const uniqueLocations = new Set(
    incidents.map((i) => i.location).filter(Boolean),
  );

  const dates = incidents
    .map((i) => i.created_at || i.date)
    .filter(Boolean)
    .map((d) => new Date(d));

  const dateRange =
    dates.length > 0
      ? {
          earliest: new Date(Math.min(...dates.map((d) => d.getTime()))),
          latest: new Date(Math.max(...dates.map((d) => d.getTime()))),
        }
      : null;

  return {
    total: incidents.length,
    uniqueRiders: uniqueRiders.size,
    uniqueLocations: uniqueLocations.size,
    dateRange,
  };
};
