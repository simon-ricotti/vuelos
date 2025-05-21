// --- Clase filtro media móvil ---
class MovingAverageFilter {
  constructor(size) {
    this.size = size;
    this.buffer = [];
  }
  add(value) {
    this.buffer.push(value);
    if (this.buffer.length > this.size) this.buffer.shift();
  }
  getAverage() {
    if (this.buffer.length === 0) return 0;
    return this.buffer.reduce((a,b) => a+b, 0) / this.buffer.length;
  }
}

// --- Promedio circular para ángulos ---
function averageAngle(degreesArray) {
  if (degreesArray.length === 0) return 0;
  let sinSum = 0, cosSum = 0;
  degreesArray.forEach(deg => {
    let rad = deg * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  });
  let avgRad = Math.atan2(sinSum / degreesArray.length, cosSum / degreesArray.length);
  if (avgRad < 0) avgRad += 2 * Math.PI;
  return avgRad * 180 / Math.PI;
}

// --- Haversine + track ---
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const Δφ = (lat2 - lat1) * toRad;
  const Δλ = (lon2 - lon1) * toRad;

  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const d = R * c;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  let θ = Math.atan2(y, x);
  θ = θ * 180 / Math.PI;
  if (θ < 0) θ += 360;

  return { distance: d, track: θ };
}

// --- Inicialización ---
const gsFilter = new MovingAverageFilter(5);
const trackBuffer = [];
const trackBufferSize = 5;

let positions = [];
let groundspeeds = [];
let tracks = [];
let altitudes = [];

let accumulatedTurn = 0;
let lastTrack = null;

let maxGs = -Infinity;
let minGs = Infinity;

const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

function processPosition(position) {
  const {latitude, longitude, accuracy, altitude} = position.coords;
  const time = position.timestamp;

  if (accuracy > 20) {
    statusEl.textContent = `Descartando por baja precisión: ${accuracy.toFixed(1)} m`;
    return;
  }

  positions.push({time, lat: latitude, lon: longitude});
  if (positions.length > 10) positions.shift();

  altitudes.push(altitude || 0);
  if (altitudes.length > 100) altitudes.shift();

  if (positions.length < 2) {
    statusEl.textContent = 'Esperando más datos GPS...';
    return;
  }

  const prev = positions[positions.length - 2];
  const curr = positions[positions.length - 1];
  const {distance, track} = haversine(prev.lat, prev.lon, curr.lat, curr.lon);

  const dt = (curr.time - prev.time) / 1000;
  if (dt <= 0) return;

  const gsRaw = (distance / dt) * 1.94384;
  gsFilter.add(gsRaw);
  const gsSmooth = gsFilter.getAverage();

  trackBuffer.push(track);
  if (trackBuffer.length > trackBufferSize) trackBuffer.shift();
  const trackSmooth = averageAngle(trackBuffer);

  groundspeeds.push(gsSmooth);
  tracks.push(trackSmooth);
  if (groundspeeds.length > 100) groundspeeds.shift();
  if (tracks.length > 100) tracks.shift();

  if (lastTrack !== null) {
    let dAngle = trackSmooth - lastTrack;
    if (dAngle > 180) dAngle -= 360;
    if (dAngle < -180) dAngle += 360;
    accumulatedTurn += Math.abs(dAngle);
  }
  lastTrack = trackSmooth;

  if (gsSmooth > maxGs) maxGs = gsSmooth;
  if (gsSmooth < minGs) minGs = gsSmooth;

  statusEl.textContent = `Acumulado giro: ${accumulatedTurn.toFixed(1)}°, GS actual: ${gsSmooth.toFixed(1)} kt`;

  if (accumulatedTurn >= 350) {
    const viento = (maxGs - minGs) / 2;
    const minGsIndex = groundspeeds.indexOf(minGs);
    const trackAtMinGs = tracks[minGsIndex];
    const vientoDesde = (trackAtMinGs + 180) % 360;

    const altitudProm = altitudes.length > 0
      ? altitudes.reduce((a, b) => a + b, 0) / altitudes.length
      : 0;

    resultEl.textContent =
      `Viento estimado: ${viento.toFixed(1)} kt desde ${vientoDesde.toFixed(0)}°\n` +
      `Altitud promedio: ${altitudProm.toFixed(0)} ft`;

    accumulatedTurn = 0;
    maxGs = -Infinity;
    minGs = Infinity;
    groundspeeds = [];
    tracks = [];
    altitudes = [];
  }
}

// --- Activar GPS ---
if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(processPosition,
    err => statusEl.textContent = `Error GPS: ${err.message}`,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
} else {
  statusEl.textContent = 'Geolocalización no soportada';
}
