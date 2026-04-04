import DB from '../database.js';
import { requireAuth } from '../services/auth-service.js';
import {
  getAllPOIs, addPOI, deletePOI, getAllGeofences, saveGeofence, deleteGeofence,
  searchByRadius, searchByZone, searchByPolygon,
  planRoute, suggestNearestEntry, distanceFeet, calculateWalkTime,
  getWalkSpeed, setWalkSpeed
} from '../services/map.js';
import { showModal, closeModal } from '../components/modal.js';
import { showNotification } from '../components/notifications.js';

const ZONE_LAYOUT = [
  { id: 'lobby', label: 'Lobby', x: 10, y: 10, w: 180, h: 100, color: '#4a9eff' },
  { id: 'office-a', label: 'Office A', x: 210, y: 10, w: 160, h: 100, color: '#34d399' },
  { id: 'office-b', label: 'Office B', x: 390, y: 10, w: 160, h: 100, color: '#34d399' },
  { id: 'warehouse', label: 'Warehouse', x: 10, y: 130, w: 340, h: 120, color: '#fbbf24' },
  { id: 'dock', label: 'Dock', x: 370, y: 130, w: 180, h: 120, color: '#f87171' }
];

// Scale factor: 1 SVG unit = 10 feet for display purposes
const SCALE = 10;

export async function renderMap(container) {
  if (!requireAuth()) return;

  const pois = await getAllPOIs();
  const geofences = await getAllGeofences();
  const walkSpeed = getWalkSpeed();

  container.innerHTML = `
    <div class="view-header">
      <h1>Venue Map & POI Management</h1>
      <div>
        <button class="btn btn-primary" id="add-poi-btn">+ Add POI</button>
        <button class="btn btn-secondary" id="draw-geofence-btn">Draw Geofence</button>
      </div>
    </div>

    <div class="map-controls">
      <div class="search-group">
        <label class="form-label">Search Mode
          <select id="search-mode" class="input">
            <option value="none">None</option>
            <option value="radius">Radius Search</option>
            <option value="zone">Zone Search</option>
            <option value="polygon">Polygon Search</option>
          </select>
        </label>
        <div id="search-params" style="display:none">
          <label class="form-label" id="radius-label" style="display:none">Radius (feet)
            <input type="number" id="search-radius" class="input" value="1500" min="1" />
          </label>
          <label class="form-label" id="zone-select-label" style="display:none">Zone
            <select id="search-zone" class="input">
              ${ZONE_LAYOUT.map(z => `<option value="${z.id}">${z.label}</option>`).join('')}
            </select>
          </label>
          <label class="form-label" id="geofence-select-label" style="display:none">Geofence
            <select id="search-geofence" class="input">
              ${geofences.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </label>
          <button class="btn btn-primary" id="search-btn">Search</button>
        </div>
      </div>
      <div class="walk-config">
        <label class="form-label">Walk Speed (mph)
          <input type="number" id="walk-speed" class="input" value="${walkSpeed}" min="0.5" max="10" step="0.5" />
        </label>
      </div>
    </div>

    <div class="map-wrapper">
      <svg id="facility-map" viewBox="0 0 570 270" class="facility-map">
        ${ZONE_LAYOUT.map(z => `
          <g class="zone-group" data-zone="${z.id}">
            <rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}"
                  rx="8" fill="${z.color}22" stroke="${z.color}" stroke-width="2" />
            <text x="${z.x + z.w / 2}" y="${z.y + 30}" text-anchor="middle"
                  class="zone-label">${z.label}</text>
          </g>
        `).join('')}
        ${pois.map(p => `
          <g class="poi-marker" data-poi-id="${p.id}">
            <circle cx="${p.x / SCALE}" cy="${p.y / SCALE}" r="5"
                    fill="${p.type === 'entry' ? '#22c55e' : p.type === 'exit' ? '#ef4444' : '#3b82f6'}" stroke="#fff" stroke-width="1" />
            <text x="${p.x / SCALE}" y="${p.y / SCALE - 8}" text-anchor="middle" class="poi-label">${p.name}</text>
          </g>
        `).join('')}
        ${geofences.map(g => `
          <polygon points="${g.points.map(p => `${p.x / SCALE},${p.y / SCALE}`).join(' ')}"
                   fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" stroke-width="1.5" stroke-dasharray="4" />
        `).join('')}
        <g id="route-overlay"></g>
        <g id="search-overlay"></g>
      </svg>
      <canvas id="geofence-canvas" class="geofence-canvas" width="570" height="270" style="display:none"></canvas>
    </div>

    <div class="map-panels">
      <div id="poi-list" class="panel">
        <h3>Points of Interest (${pois.length})</h3>
        ${pois.length === 0 ? '<p class="empty-state">No POIs. Add one to get started.</p>' : ''}
        <ul class="poi-list">
          ${pois.map(p => `
            <li class="poi-item">
              <span><strong>${p.name}</strong> (${p.x} ft, ${p.y} ft) — ${p.type} ${p.zone ? '@ ' + p.zone : ''}</span>
              <div>
                <button class="btn btn-sm" data-action="route-to" data-poi-id="${p.id}">Route</button>
                <button class="btn btn-sm btn-danger" data-action="delete-poi" data-poi-id="${p.id}">Delete</button>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
      <div id="route-result" class="panel" style="display:none"></div>
      <div id="search-result" class="panel" style="display:none"></div>
    </div>
  `;

  // Walk speed
  document.getElementById('walk-speed').addEventListener('change', (e) => {
    setWalkSpeed(parseFloat(e.target.value));
    showNotification('Walk speed updated', 'success');
  });

  // Search mode
  document.getElementById('search-mode').addEventListener('change', (e) => {
    const mode = e.target.value;
    document.getElementById('search-params').style.display = mode === 'none' ? 'none' : '';
    document.getElementById('radius-label').style.display = mode === 'radius' ? '' : 'none';
    document.getElementById('zone-select-label').style.display = mode === 'zone' ? '' : 'none';
    document.getElementById('geofence-select-label').style.display = mode === 'polygon' ? '' : 'none';
  });

  // Search button
  document.getElementById('search-btn')?.addEventListener('click', () => {
    const mode = document.getElementById('search-mode').value;
    let results = [];

    if (mode === 'radius') {
      const radius = parseInt(document.getElementById('search-radius').value);
      // Use center of map as search center (could be enhanced to click-to-set)
      const center = { x: 2850, y: 1350 };
      results = searchByRadius(pois, center, radius);
    } else if (mode === 'zone') {
      const zone = document.getElementById('search-zone').value;
      results = searchByZone(pois, zone);
    } else if (mode === 'polygon') {
      const geoId = parseInt(document.getElementById('search-geofence').value);
      const geo = geofences.find(g => g.id === geoId);
      if (geo) results = searchByPolygon(pois, geo.points);
    }

    const panel = document.getElementById('search-result');
    panel.style.display = '';
    panel.innerHTML = `
      <h3>Search Results (${results.length})</h3>
      ${results.length === 0 ? '<p>No POIs found.</p>' : `
        <ul class="poi-list">${results.map(p => `<li class="poi-item"><strong>${p.name}</strong> (${p.x} ft, ${p.y} ft)</li>`).join('')}</ul>
      `}
    `;
  });

  // Route to POI
  container.querySelectorAll('[data-action="route-to"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const poiId = Number(btn.dataset.poiId);
      const target = pois.find(p => p.id === poiId);
      if (!target) return;

      const entry = suggestNearestEntry(pois, { x: target.x, y: target.y });
      const from = entry ? { x: entry.poi.x, y: entry.poi.y } : { x: 0, y: 0 };
      const route = planRoute(from, { x: target.x, y: target.y });

      const panel = document.getElementById('route-result');
      panel.style.display = '';
      panel.innerHTML = `
        <h3>Route to ${target.name}</h3>
        ${entry ? `<p>Suggested entry: <strong>${entry.poi.name}</strong></p>` : '<p>No entry points defined.</p>'}
        <p>Total distance: <strong>${route.totalDistanceFeet} ft</strong></p>
        <p>Est. walk time: <strong>${route.totalWalkTimeMinutes} min</strong> at ${getWalkSpeed()} mph</p>
        ${route.segments.map((s, i) => `
          <p class="route-segment">Segment ${i + 1}: ${s.distanceFeet} ft (${s.walkTimeMinutes} min)</p>
        `).join('')}
      `;

      // Draw route on SVG
      const overlay = document.getElementById('route-overlay');
      overlay.innerHTML = `
        <line x1="${from.x / SCALE}" y1="${from.y / SCALE}" x2="${target.x / SCALE}" y2="${target.y / SCALE}"
              stroke="#8b5cf6" stroke-width="2" stroke-dasharray="5,3" />
        <circle cx="${from.x / SCALE}" cy="${from.y / SCALE}" r="4" fill="#22c55e" />
        <circle cx="${target.x / SCALE}" cy="${target.y / SCALE}" r="4" fill="#ef4444" />
      `;
    });
  });

  // Delete POI
  container.querySelectorAll('[data-action="delete-poi"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deletePOI(Number(btn.dataset.poiId));
      showNotification('POI deleted', 'success');
      renderMap(container);
    });
  });

  // Add POI
  document.getElementById('add-poi-btn').addEventListener('click', () => {
    showModal('Add Point of Interest', `
      <form id="poi-form">
        <label class="form-label">Name
          <input type="text" name="name" class="input" required />
        </label>
        <label class="form-label">X Coordinate (feet)
          <input type="number" name="x" class="input" required min="0" />
        </label>
        <label class="form-label">Y Coordinate (feet)
          <input type="number" name="y" class="input" required min="0" />
        </label>
        <label class="form-label">Type
          <select name="type" class="input">
            <option value="general">General</option>
            <option value="entry">Entry Point</option>
            <option value="exit">Exit Point</option>
            <option value="amenity">Amenity</option>
          </select>
        </label>
        <label class="form-label">Zone
          <select name="zone" class="input">
            <option value="">None</option>
            ${ZONE_LAYOUT.map(z => `<option value="${z.id}">${z.label}</option>`).join('')}
          </select>
        </label>
        <label class="form-label">Description
          <input type="text" name="description" class="input" />
        </label>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Add POI</button>
          <button type="button" class="btn btn-secondary" id="cancel-poi">Cancel</button>
        </div>
      </form>
    `);

    document.getElementById('cancel-poi').addEventListener('click', closeModal);
    document.getElementById('poi-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd);
      data.x = parseInt(data.x);
      data.y = parseInt(data.y);
      await addPOI(data);
      showNotification('POI added', 'success');
      closeModal();
      renderMap(container);
    });
  });

  // Draw Geofence
  document.getElementById('draw-geofence-btn').addEventListener('click', () => {
    const canvas = document.getElementById('geofence-canvas');
    canvas.style.display = '';
    const ctx = canvas.getContext('2d');
    const points = [];

    showNotification('Click on the map to draw polygon points. Double-click to finish.', 'info');

    function drawPoints() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (points.length === 0) return;

      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(139,92,246,0.2)';

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();

      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#8b5cf6';
        ctx.fill();
      }
    }

    function onClick(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      points.push({ x: Math.round(x * SCALE), y: Math.round(y * SCALE) });
      drawPoints();
    }

    function onDblClick(e) {
      e.preventDefault();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.style.display = 'none';

      if (points.length < 3) {
        showNotification('Need at least 3 points for a geofence', 'warning');
        return;
      }

      showModal('Save Geofence', `
        <form id="geofence-form">
          <label class="form-label">Geofence Name
            <input type="text" name="name" class="input" required />
          </label>
          <label class="form-label">Zone
            <select name="zone" class="input">
              <option value="">None</option>
              ${ZONE_LAYOUT.map(z => `<option value="${z.id}">${z.label}</option>`).join('')}
            </select>
          </label>
          <p>${points.length} points drawn</p>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-secondary" id="cancel-geofence">Cancel</button>
          </div>
        </form>
      `);

      document.getElementById('cancel-geofence').addEventListener('click', closeModal);
      document.getElementById('geofence-form').addEventListener('submit', async (e2) => {
        e2.preventDefault();
        const fd = new FormData(e2.target);
        await saveGeofence({ name: fd.get('name'), zone: fd.get('zone'), points });
        showNotification('Geofence saved', 'success');
        closeModal();
        renderMap(container);
      });
    }

    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDblClick);
  });
}
