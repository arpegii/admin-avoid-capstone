/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { supabaseClient } from "../App";

// ─────────────────────────────────────────────────────────────
// Helpers (duplicated here so context is self-contained)
// ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const geocodeAddress = async (address, retries = 2) => {
  if (!address || !address.trim()) return { lat: null, lng: null };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await sleep(1500 * attempt);

      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        address.trim(),
      )}&limit=1&addressdetails=1`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "AVOID-CapstoneApp/1.0 (admin-avoid-capstone.vercel.app)",
        },
      });

      if (!res.ok) continue; // retry on non-200

      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (isFinite(lat) && isFinite(lng)) return { lat, lng };
      }

      // No results found — no point retrying
      return { lat: null, lng: null };
    } catch {
      // Network/parse error — retry if we have attempts left
      if (attempt >= retries) return { lat: null, lng: null };
      // else loop continues to next attempt
    }
  }

  return { lat: null, lng: null }; // exhausted all retries
};

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────

const ImportContext = createContext(null);

export const useImport = () => {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error("useImport must be used within ImportProvider");
  return ctx;
};

// bgImport shape:
// { status: 'running'|'done'|'error'|'cancelled', current, total, fileName, rowCount, errorMsg }

export const ImportProvider = ({
  children,
  onImportComplete,
  onImportFailed,
}) => {
  const [bgImport, setBgImport] = useState(null);
  const [panelMinimized, setPanelMinimized] = useState(false);
  const cancelRef = useRef(false);
  // Callback ref so Parcel.jsx can pass a "reload parcels" fn
  const onDoneCallbackRef = useRef(null);

  // ── Warn on refresh/close while import is running ──
  useEffect(() => {
    const handler = (e) => {
      if (bgImport?.status !== "running") return;
      e.preventDefault();
      e.returnValue =
        "A CSV import is in progress. Leaving will cancel the import.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [bgImport?.status]);

  // ── Start a background import ──
  const startImport = useCallback(
    (csvRows, fileName, onDone) => {
      if (!csvRows?.length) return;

      cancelRef.current = false;
      onDoneCallbackRef.current = onDone || null;

      const total = csvRows.length;
      const rowsSnapshot = [...csvRows];

      setBgImport({
        status: "running",
        current: 0,
        total,
        fileName,
        rowCount: total,
        errorMsg: null,
      });
      setPanelMinimized(false);

      // Fire-and-forget async loop
      (async () => {
        const enriched = [];

        for (let i = 0; i < rowsSnapshot.length; i++) {
          if (cancelRef.current) {
            setBgImport((prev) =>
              prev ? { ...prev, status: "cancelled" } : null,
            );
            return;
          }

          const row = rowsSnapshot[i];
          setBgImport((prev) => (prev ? { ...prev, current: i + 1 } : null));

          // Use pre-geocoded coords from CSV if available, otherwise call Nominatim
          let lat = parseFloat(row.r_lat);
          let lng = parseFloat(row.r_lng);
          const hasCoords = isFinite(lat) && isFinite(lng);

          if (!hasCoords) {
            const result = await geocodeAddress(row.address || "");
            lat = result.lat;
            lng = result.lng;
            // Only sleep for rate limiting when we actually called Nominatim
            if (i < rowsSnapshot.length - 1) await sleep(1200);
          }

          // Normalize status values to match database check constraints:
          // status        → 'on-going' | 'successfully delivered' | 'cancelled'
          // attempt_status → 'pending' | 'failed' | 'success'
          const normalizeStatus = (val, fallback) => {
            if (!val || !String(val).trim()) return fallback;
            const s = String(val).trim().toLowerCase();
            return s;
          };

          const rawLat = parseFloat(lat);
          const rawLng = parseFloat(lng);

          enriched.push({
            recipient_name: row.recipient_name || null,
            recipient_phone: row.recipient_phone || null,
            address: row.address || null,
            sender_name: row.sender_name || null,
            sender_phone: row.sender_phone || null,
            status: normalizeStatus(row.status, "on-going"),
            attempt1_status: row.attempt1_status
              ? normalizeStatus(row.attempt1_status, null)
              : null,
            attempt1_date: row.attempt1_date || null,
            attempt2_status: row.attempt2_status
              ? normalizeStatus(row.attempt2_status, null)
              : null,
            attempt2_date: row.attempt2_date || null,
            parcel_image_proof: row.parcel_image_proof || null,
            r_lat: isFinite(rawLat) ? rawLat : null,
            r_lng: isFinite(rawLng) ? rawLng : null,
          });
        }

        if (cancelRef.current) {
          setBgImport((prev) =>
            prev ? { ...prev, status: "cancelled" } : null,
          );
          return;
        }

        // Batch insert
        const chunkSize = 50;
        for (let i = 0; i < enriched.length; i += chunkSize) {
          if (cancelRef.current) {
            setBgImport((prev) =>
              prev ? { ...prev, status: "cancelled" } : null,
            );
            return;
          }
          const chunk = enriched.slice(i, i + chunkSize);
          const { error } = await supabaseClient.from("parcels").insert(chunk);
          if (error) {
            console.error("CSV insert error:", error);
            setBgImport((prev) =>
              prev
                ? { ...prev, status: "error", errorMsg: error.message }
                : null,
            );
            // Fire notification with parsed reason
            if (onImportFailed) onImportFailed(error.message, fileName);
            return;
          }
        }

        setBgImport((prev) =>
          prev ? { ...prev, status: "done", current: total } : null,
        );

        // Notify + reload
        if (onImportComplete) onImportComplete(total, fileName);
        if (onDoneCallbackRef.current) onDoneCallbackRef.current();

        // Auto-dismiss after 6 s
        setTimeout(() => setBgImport(null), 6000);
      })();
    },
    [onImportComplete],
  );

  const cancelImport = useCallback(() => {
    cancelRef.current = true;
    setBgImport((prev) => (prev ? { ...prev, status: "cancelled" } : null));
  }, []);

  const dismissPanel = useCallback(() => setBgImport(null), []);

  return (
    <ImportContext.Provider
      value={{
        bgImport,
        panelMinimized,
        setPanelMinimized,
        startImport,
        cancelImport,
        dismissPanel,
      }}
    >
      {children}
    </ImportContext.Provider>
  );
};
