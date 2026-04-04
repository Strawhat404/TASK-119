import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import actual production logic from lib
import {
  distanceFeet,
  searchByRadius,
  searchByZone,
  pointInPolygon,
  searchByPolygon,
  calculateWalkTime,
  planRoute,
  suggestNearestEntry,
  FEET_PER_MILE,
  DEFAULT_WALK_SPEED_MPH
} from '../frontend/js/lib/map-logic.js';

describe('Radius Search', () => {
  const pois = [
    { x: 0, y: 0, name: 'Origin' },
    { x: 100, y: 0, name: 'Near' },
    { x: 2000, y: 2000, name: 'Far' }
  ];

  it('should find POIs within radius', () => {
    const results = searchByRadius(pois, { x: 0, y: 0 }, 150);
    assert.equal(results.length, 2);
  });

  it('should find POIs within 1500 ft radius', () => {
    const results = searchByRadius(pois, { x: 0, y: 0 }, 1500);
    assert.equal(results.length, 2);
  });

  it('should find all POIs within large radius', () => {
    const results = searchByRadius(pois, { x: 0, y: 0 }, 5000);
    assert.equal(results.length, 3);
  });

  it('should find nothing with tiny radius', () => {
    const results = searchByRadius(pois, { x: 500, y: 500 }, 1);
    assert.equal(results.length, 0);
  });

  it('should include POI at exact radius boundary', () => {
    const results = searchByRadius([{ x: 100, y: 0 }], { x: 0, y: 0 }, 100);
    assert.equal(results.length, 1);
  });
});

describe('Zone Search', () => {
  const pois = [
    { x: 0, y: 0, zone: 'lobby', name: 'A' },
    { x: 100, y: 0, zone: 'lobby', name: 'B' },
    { x: 200, y: 0, zone: 'dock', name: 'C' }
  ];

  it('should find POIs in specified zone', () => {
    assert.equal(searchByZone(pois, 'lobby').length, 2);
    assert.equal(searchByZone(pois, 'dock').length, 1);
  });

  it('should return empty for unknown zone', () => {
    assert.equal(searchByZone(pois, 'unknown').length, 0);
  });
});

describe('Polygon Geofence Search', () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];

  it('should find POIs inside polygon', () => {
    const pois = [
      { x: 50, y: 50, name: 'Inside' },
      { x: 200, y: 200, name: 'Outside' }
    ];
    const results = searchByPolygon(pois, polygon);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Inside');
  });

  it('should handle point outside polygon', () => {
    assert.equal(pointInPolygon({ x: 200, y: 200 }, polygon), false);
  });

  it('should handle point inside polygon', () => {
    assert.equal(pointInPolygon({ x: 50, y: 50 }, polygon), true);
  });
});

describe('Walk Time Calculation', () => {
  it('should calculate walk time at default 3 mph', () => {
    const time = calculateWalkTime(FEET_PER_MILE, DEFAULT_WALK_SPEED_MPH);
    assert.equal(time, 20);
  });

  it('should calculate walk time for shorter distance', () => {
    const time = calculateWalkTime(1320, 3);
    assert.equal(time, 5);
  });

  it('should calculate zero distance as zero time', () => {
    assert.equal(calculateWalkTime(0, 3), 0);
  });

  it('should adjust for different speeds', () => {
    const time = calculateWalkTime(FEET_PER_MILE, 6);
    assert.equal(time, 10);
  });

  it('should handle slow walk speed', () => {
    const time = calculateWalkTime(FEET_PER_MILE, 1);
    assert.equal(time, 60);
  });
});

describe('Route Planning', () => {
  it('should calculate direct route', () => {
    const route = planRoute({ x: 0, y: 0 }, { x: 300, y: 400 });
    assert.equal(route.totalDistanceFeet, 500);
    assert.equal(route.segments.length, 1);
  });

  it('should calculate route with waypoints', () => {
    const route = planRoute(
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      [{ x: 100, y: 0 }]
    );
    assert.equal(route.totalDistanceFeet, 200);
    assert.equal(route.segments.length, 2);
    assert.equal(route.segments[0].distanceFeet, 100);
    assert.equal(route.segments[1].distanceFeet, 100);
  });

  it('should calculate walk time for route', () => {
    const route = planRoute({ x: 0, y: 0 }, { x: FEET_PER_MILE, y: 0 }, [], 3);
    assert.equal(route.totalWalkTimeMinutes, 20);
  });

  it('should handle zero-distance route', () => {
    const route = planRoute({ x: 50, y: 50 }, { x: 50, y: 50 });
    assert.equal(route.totalDistanceFeet, 0);
    assert.equal(route.totalWalkTimeMinutes, 0);
  });
});

describe('Distance Calculation', () => {
  it('should calculate horizontal distance', () => {
    assert.equal(distanceFeet({ x: 0, y: 0 }, { x: 100, y: 0 }), 100);
  });

  it('should calculate vertical distance', () => {
    assert.equal(distanceFeet({ x: 0, y: 0 }, { x: 0, y: 50 }), 50);
  });

  it('should calculate diagonal distance', () => {
    assert.equal(distanceFeet({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });

  it('should return 0 for same point', () => {
    assert.equal(distanceFeet({ x: 10, y: 20 }, { x: 10, y: 20 }), 0);
  });
});

describe('Nearest Entry Suggestion', () => {
  it('should find nearest entry point', () => {
    const pois = [
      { x: 0, y: 0, type: 'entry', name: 'Gate A' },
      { x: 1000, y: 0, type: 'entry', name: 'Gate B' },
      { x: 500, y: 500, type: 'general', name: 'Info' }
    ];
    const result = suggestNearestEntry(pois, { x: 900, y: 0 });
    assert.equal(result.poi.name, 'Gate B');
  });

  it('should return null when no entry points', () => {
    const pois = [{ x: 0, y: 0, type: 'general', name: 'A' }];
    assert.equal(suggestNearestEntry(pois, { x: 0, y: 0 }), null);
  });
});
