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
    return this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;
  }
}

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

const gsFilter = new MovingAverageFilter(5);
const altFilter = new MovingAverageFilter(5);
const trackBuffer = [];
const trackBufferSize = 5;

let positions = [];
let gsTrackPairs = [];
let altitudes = [];

let accumulatedTurn = 0;
let lastTrack = null;

let maxGs = -Infinity;
let minGs = Infinity;

let statusEl = null;
let resultEl = null;
let watchId = null;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const Δφ = (lat2 - lat1) * toRad;
  const Δλ = (lon2 - lon1) * toRad;

  const a = Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = Math.atan2(y, x) * 180 / Math.PI;
  if (θ < 0) θ += 360;

  return { distance: d, track: θ };
}

function processPosition(position) {
  const { latitude, longitude, accuracy, altitude } = position.coords;
  const time = position.timestamp;

  if (accuracy > 20) {
    statusEl.textContent = `Descartando por baja precisión: ${accuracy.toFixed(1)} m`;
    return;
  }

  positions.push({ time, lat: latitude, lon: longitude, alt: altitude || 0 });
  if (positions.length > 10) positions.shift();

  if (positions.length < 2) {
    statusEl.textContent = 'Esperando más datos GPS...';
    return;
  }

  const prev = positions[positions.length - 2];
  const curr = positions[positions.length - 1];
  const { distance, track } = haversine(prev.lat, prev.lon, curr.lat, curr.lon);
  const dt = (curr.time - prev.time) / 1000;
  if (dt <= 0) return;

  const gsRaw = (distance / dt) * 1.94384;
  gsFilter.add(gsRaw);
  const gsSmooth = gsFilter.getAverage();

  trackBuffer.push(track);
  if (trackBuffer.length > trackBufferSize) trackBuffer.shift();
  const trackSmooth = averageAngle(trackBuffer);
  const trackRounded = Math.round(trackSmooth);

  altFilter.add(curr.alt);
  const altProm = altFilter.getAverage();

  gsTrackPairs.push({ gs: gsSmooth, track: trackSmooth });
  altitudes.push(altProm);
  if (gsTrackPairs.length > 100) {
    gsTrackPairs.shift();
    altitudes.shift();
  }

  if (lastTrack !== null) {
    let dAngle = trackSmooth - lastTrack;
    if (dAngle > 180) dAngle -= 360;
    if (dAngle < -180) dAngle += 360;
    accumulatedTurn += Math.abs(dAngle);
  }
  lastTrack = trackSmooth;

  if (gsSmooth > maxGs) maxGs = gsSmooth;
  if (gsSmooth < minGs) minGs = gsSmooth;

  statusEl.textContent =
    `Acumulado giro: ${accumulatedTurn.toFixed(1)}°, GS: ${gsSmooth.toFixed(1)} kt, Rumbo: ${trackRounded}°`;

  if (accumulatedTurn >= 350) {
    const viento = (maxGs - minGs) / 2;

    // Track asociado al GS mínimo
    const minPair = gsTrackPairs.reduce((min, pair) => pair.gs < min.gs ? pair : min, gsTrackPairs[0]);
    const windDir = (minPair.track + 180) % 360;
    const altPromFt = altitudes.reduce((a, b) => a + b, 0) / altitudes.length * 3.28084;

    // Mostrar resultado
    resultEl.innerHTML = `${Math.round(altPromFt)} ft: ${viento.toFixed(1)} kt desde ${Math.round(windDir)}°`;

    // --- GUARDAR EN LOCALSTORAGE ---
    const timestamp = new Date().toISOString();
    const data = {
      timestamp,
      altitud_ft: Math.round(altPromFt),
      viento_kt: viento.toFixed(1),
      direccion_desde: Math.round(windDir),
      muestras: gsTrackPairs.map(p => ({
        gs: p.gs.toFixed(1),
        track: Math.round(p.track)
      }))
    };

    let historial = JSON.parse(localStorage.getItem('vientoLogs')) || [];
    historial.push(data);
    localStorage.setItem('vientoLogs', JSON.stringify(historial));

    // Reiniciar buffers
    resetData();
  }
}

function resetData() {
  positions = [];
  gsTrackPairs = [];
  altitudes = [];
  accumulatedTurn = 0;
  lastTrack = null;
  maxGs = -Infinity;
  minGs = Infinity;
  gsFilter.buffer = [];
  altFilter.buffer = [];
  trackBuffer.length = 0;
}

export function initWindEstimator(statusElementId, resultElementId, toggleElementId) {
  statusEl = document.getElementById(statusElementId);
  resultEl = document.getElementById(resultElementId);

  const toggle = document.getElementById(toggleElementId);

  toggle.addEventListener('change', e => {
    const enabled = e.target.checked;

    if (enabled) {
      if ('geolocation' in navigator) {
        watchId = navigator.geolocation.watchPosition(
          processPosition,
          err => statusEl.textContent = `Error GPS: ${err.message}`,
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
        statusEl.textContent = 'Esperando más datos GPS...';
      } else {
        statusEl.textContent = 'Geolocalización no soportada en este navegador';
      }
    } else {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      statusEl.textContent = 'Sacar Vientos desactivado';
      resultEl.innerHTML = '';
      resetData();
    }
  });
}
