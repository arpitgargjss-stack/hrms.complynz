/** Geofence maths. Coordinates are used transiently for the inside/outside check and must never be stored or logged. */
const R = 6371008.8; // mean earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** true/false when decidable, null when the point or the office coordinates are missing or malformed. */
export function withinGeofence(point: { lat?: number | null; lng?: number | null }, office: { lat?: string | number | null; lng?: string | number | null; radiusM?: number | null }): boolean | null {
  const oLat = office.lat == null || office.lat === "" ? NaN : Number(office.lat);
  const oLng = office.lng == null || office.lng === "" ? NaN : Number(office.lng);
  if (point.lat == null || point.lng == null || !Number.isFinite(oLat) || !Number.isFinite(oLng)) return null;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return haversineMeters(point.lat, point.lng, oLat, oLng) <= (office.radiusM ?? 150);
}
