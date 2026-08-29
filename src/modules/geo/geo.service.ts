/**
 * Geo Service — Google Maps Platform integration
 * - Reverse geocoding (lat/lng → human address)
 * - Nearby Places search (police stations, hospitals)
 * - Distance calculation (Haversine formula — no API call needed)
 */

import { logger } from '../../shared/logger.js';

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLACES_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

// ─── Haversine distance (km) ──────────────────────────────────────────────────
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Reverse geocode ─────────────────────────────────────────────────────────
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  if (!GOOGLE_API_KEY || GOOGLE_API_KEY.includes('Demo')) {
    // Fallback: return formatted coords
    return `${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`;
  }
  try {
    const url = `${GEOCODE_URL}?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}&language=en&result_type=street_address|sublocality|locality`;
    const resp = await fetch(url);
    const data = await resp.json() as {
      status: string;
      results: Array<{ formatted_address: string }>;
    };
    if (data.status === 'OK' && data.results.length > 0) {
      return data.results[0].formatted_address;
    }
  } catch (err) {
    logger.warn('Reverse geocode failed', err);
  }
  return `${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`;
}

// ─── Nearby places ────────────────────────────────────────────────────────────
export interface NearbyPlace {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  phone?: string;
  rating?: number;
  openNow?: boolean;
  type: 'police' | 'hospital';
  mapsUrl: string;
}

type PlaceType = 'police' | 'hospital';

async function fetchNearbyPlaces(
  lat: number,
  lng: number,
  type: PlaceType,
  radiusMeters = 10000,
): Promise<NearbyPlace[]> {
  if (!GOOGLE_API_KEY || GOOGLE_API_KEY.includes('Demo')) {
    // Return demo data when no API key
    return getDemoPlaces(lat, lng, type);
  }

  try {
    const keyword = type === 'police' ? 'police+station' : 'hospital';
    const url = `${PLACES_URL}?location=${lat},${lng}&radius=${radiusMeters}&type=${type === 'police' ? 'police' : 'hospital'}&keyword=${keyword}&key=${GOOGLE_API_KEY}&language=en`;
    const resp = await fetch(url);
    const data = await resp.json() as {
      status: string;
      results: Array<{
        place_id: string;
        name: string;
        vicinity: string;
        geometry: { location: { lat: number; lng: number } };
        rating?: number;
        opening_hours?: { open_now: boolean };
      }>;
    };

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      logger.warn(`Google Places API error: ${data.status}`);
      return getDemoPlaces(lat, lng, type);
    }

    return (data.results ?? []).slice(0, 8).map((p) => {
      const pLat = p.geometry.location.lat;
      const pLng = p.geometry.location.lng;
      return {
        id: p.place_id,
        name: p.name,
        address: p.vicinity,
        latitude: pLat,
        longitude: pLng,
        distanceKm: Math.round(haversineKm(lat, lng, pLat, pLng) * 10) / 10,
        rating: p.rating,
        openNow: p.opening_hours?.open_now,
        type,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${p.place_id}`,
      };
    }).sort((a, b) => a.distanceKm - b.distanceKm);
  } catch (err) {
    logger.warn('Google Places fetch failed', err);
    return getDemoPlaces(lat, lng, type);
  }
}

// ─── Demo data (when no API key) ─────────────────────────────────────────────
function getDemoPlaces(lat: number, lng: number, type: PlaceType): NearbyPlace[] {
  // Generate realistic nearby places based on actual coordinates
  const offsets = [
    { dlat: 0.008, dlng: 0.005, dist: 1.1 },
    { dlat: -0.012, dlng: 0.018, dist: 2.3 },
    { dlat: 0.022, dlng: -0.009, dist: 2.9 },
    { dlat: -0.031, dlng: 0.026, dist: 4.5 },
  ];

  const policeNames = ['Police Station', 'Police Chowki', 'Traffic Police Post', 'District Police HQ'];
  const hospitalNames = ['General Hospital', 'Community Health Centre', 'Primary Health Centre', 'District Hospital'];

  return offsets.map((o, i) => {
    const pLat = lat + o.dlat;
    const pLng = lng + o.dlng;
    const name = type === 'police' ? policeNames[i] : hospitalNames[i];
    return {
      id: `demo-${type}-${i}`,
      name: `${name} (Nearby)`,
      address: `Near ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      latitude: pLat,
      longitude: pLng,
      distanceKm: Math.round(haversineKm(lat, lng, pLat, pLng) * 10) / 10,
      type,
      mapsUrl: `https://www.google.com/maps/search/${encodeURIComponent(type === 'police' ? 'police station' : 'hospital')}/@${lat},${lng},14z`,
      openNow: true,
    };
  }).sort((a, b) => a.distanceKm - b.distanceKm);
}

export const geoService = {
  reverseGeocode,
  nearbyPolice: (lat: number, lng: number, radius?: number) =>
    fetchNearbyPlaces(lat, lng, 'police', radius),
  nearbyHospitals: (lat: number, lng: number, radius?: number) =>
    fetchNearbyPlaces(lat, lng, 'hospital', radius),
  haversineKm,
};
