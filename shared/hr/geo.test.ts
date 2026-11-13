import test from "node:test";
import assert from "node:assert/strict";
import { haversineMeters, withinGeofence } from "./geo";

test("haversine: zero distance and known distance", () => {
  assert.equal(haversineMeters(28.6, 77.2, 28.6, 77.2), 0);
  // Delhi to Mumbai is roughly 1150 km
  const d = haversineMeters(28.6139, 77.209, 19.076, 72.8777) / 1000;
  assert.ok(d > 1100 && d < 1200, String(d));
});
test("haversine: 0.001 degree latitude is about 111 m", () => {
  const d = haversineMeters(28.6, 77.2, 28.601, 77.2);
  assert.ok(d > 105 && d < 117, String(d));
});
test("withinGeofence inside, outside and unknown", () => {
  const office = { lat: "28.6000", lng: "77.2000", radiusM: 150 };
  assert.equal(withinGeofence({ lat: 28.6005, lng: 77.2 }, office), true);
  assert.equal(withinGeofence({ lat: 28.61, lng: 77.2 }, office), false);
  assert.equal(withinGeofence({}, office), null);
  assert.equal(withinGeofence({ lat: 1, lng: 1 }, { lat: null, lng: null }), null);
  assert.equal(withinGeofence({ lat: 28.6, lng: 77.2 }, { lat: "x", lng: "y" }), null);
});
