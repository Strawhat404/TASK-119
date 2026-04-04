/**
 * Pure map/POI logic — no browser/DB dependencies.
 */

export const DEFAULT_WALK_SPEED_MPH = 3;
export const FEET_PER_MILE = 5280;

export function distanceFeet(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function searchByRadius(pois, center, radiusFeet) {
  return pois.filter(poi => {
    const dist = distanceFeet(center, { x: poi.x, y: poi.y });
    return dist <= radiusFeet;
  });
}

export function searchByZone(pois, zone) {
  return pois.filter(poi => poi.zone === zone);
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function searchByPolygon(pois, polygon) {
  return pois.filter(poi => pointInPolygon({ x: poi.x, y: poi.y }, polygon));
}

export function calculateWalkTime(distanceFeetVal, speedMph = DEFAULT_WALK_SPEED_MPH) {
  const distanceMiles = distanceFeetVal / FEET_PER_MILE;
  const hours = distanceMiles / speedMph;
  const minutes = hours * 60;
  return Math.round(minutes * 10) / 10;
}

export function planRoute(from, to, waypoints = [], speedMph = DEFAULT_WALK_SPEED_MPH) {
  const points = [from, ...waypoints, to];
  let totalDistance = 0;

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dist = distanceFeet(points[i], points[i + 1]);
    totalDistance += dist;
    segments.push({
      from: points[i],
      to: points[i + 1],
      distanceFeet: Math.round(dist),
      walkTimeMinutes: calculateWalkTime(dist, speedMph)
    });
  }

  return {
    segments,
    totalDistanceFeet: Math.round(totalDistance),
    totalWalkTimeMinutes: calculateWalkTime(totalDistance, speedMph),
    suggestedEntryPoint: from
  };
}

export function getEntryPoints(pois) {
  return pois.filter(p => p.type === 'entry');
}

export function suggestNearestEntry(pois, target, speedMph = DEFAULT_WALK_SPEED_MPH) {
  const entries = getEntryPoints(pois);
  if (entries.length === 0) return null;

  let nearest = entries[0];
  let minDist = distanceFeet(target, { x: entries[0].x, y: entries[0].y });

  for (let i = 1; i < entries.length; i++) {
    const dist = distanceFeet(target, { x: entries[i].x, y: entries[i].y });
    if (dist < minDist) {
      minDist = dist;
      nearest = entries[i];
    }
  }

  return {
    poi: nearest,
    distanceFeet: Math.round(minDist),
    walkTimeMinutes: calculateWalkTime(minDist, speedMph)
  };
}
