/**
 * Venue Map & POI Management service.
 * - Manually entered coordinates (feet-based display)
 * - Search by radius, administrative zone, polygon geofence
 * - Route planning with estimated walk time
 * - Configurable walk speed (default 3 mph)
 */
import DB from '../database.js';

// Re-export all pure functions from lib
export {
  distanceFeet,
  searchByRadius,
  searchByZone,
  pointInPolygon,
  searchByPolygon,
  calculateWalkTime,
  planRoute,
  getEntryPoints,
  suggestNearestEntry,
  DEFAULT_WALK_SPEED_MPH,
  FEET_PER_MILE
} from '../lib/map-logic.js';

export function setWalkSpeed(mph) {
  localStorage.setItem('hg_walk_speed', String(mph));
}

export function getWalkSpeed() {
  const stored = localStorage.getItem('hg_walk_speed');
  return stored ? parseFloat(stored) : 3;
}

export async function addPOI(poi) {
  const record = {
    name: poi.name,
    x: poi.x,
    y: poi.y,
    zone: poi.zone || null,
    type: poi.type || 'general',
    description: poi.description || '',
    createdAt: Date.now()
  };
  const id = await DB.add('pois', record);
  return { ...record, id };
}

export async function updatePOI(poi) {
  await DB.put('pois', poi);
  return poi;
}

export async function deletePOI(id) {
  await DB.remove('pois', id);
}

export async function getAllPOIs() {
  return DB.getAll('pois');
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[<>"'&]/g, '').trim().slice(0, 200);
}

export async function saveGeofence(geofence) {
  const record = {
    name: sanitizeName(geofence.name),
    zone: geofence.zone || null,
    points: geofence.points,
    createdAt: Date.now()
  };
  const id = await DB.add('geofences', record);
  return { ...record, id };
}

export async function getAllGeofences() {
  return DB.getAll('geofences');
}

export async function deleteGeofence(id) {
  await DB.remove('geofences', id);
}
