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
let groundspeeds = [];
let tracks = [];

let accumulatedTurn = 0;
let lastTrack = null;

let maxGs = -Infinity;
let minGs = Infinity;
let trackMinGs = 0;

let statusEl = document.getElementById('status');
let resultEl = document.getElementById('result');
let active = false;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad, φ2 = lat2 * toRad;
  const Δφ = (lat2 - lat1) * toRad;
  const Δλ = (lon2 - lon1) * toRad;

  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const d = R * c;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  let θ = Math.atan2(y, x) * 180 / Math.PI;
  if (θ < 0) θ += 360;

  return { distance: d, track: θ };
}

function processPosition(position) {
  if (!active) return;

  const {latitude, longitude, altitude, accuracy} = position.coords;
  const time = position.timestamp;

  if (accuracy > 20) {
    statusEl.textContent = `Descartando por baja precisión: ${accuracy.toFixed(1)} m`;
    return;
  }

  altFilter.add(altitude || 0);
  const altAvg = altFilter.getAverage();

  positions.push({time, lat: latitude, lon: longitude, alt: altAvg});
  if (positions.length > 10) positions.shift();

  if (positions.length < 2) {
    statusEl.textContent = 'Esperando más datos GPS...';
    return;
  }

  const prev = positions[positions.length - 2];
  const curr = positions[positions.length - 1];
  const {distance, track} = haversine(prev.lat, prev.lon, curr.lat, curr.lon);
  const dt = (curr.time - prev.time) / 1000;
  if (dt <= 0) return;

  let gsRaw = (distance / dt) * 1.94384;
  gsFilter.add(gsRaw);
  const gsSmooth = gsFilter.getAverage();

  trackBuffer.push(track);
  if (trackBuffer.length > trackBufferSize) trackBuffer.shift();
  const trackSmooth = averageAngle(trackBuffer);

  groundspeeds.push(gsSmooth);
  tracks.push(trackSmooth);
  if (groundspeeds.length > 100) {
    groundspeeds.shift();
    tracks.shift();
  }

  if (lastTrack !== null) {
    let dAngle = trackSmooth - lastTrack;
    if (dAngle > 180) dAngle -= 360;
    if (dAngle < -180) dAngle += 360;
    accumulatedTurn += Math.abs(dAngle);
  }
  lastTrack = trackSmooth;

  if (gsSmooth > maxGs) maxGs = gsSmooth;
  if (gsSmooth < minGs) {
    minGs = gsSmooth;
    trackMinGs = trackSmooth;
  }

  statusEl.textContent = `Acumulado giro: ${accumulatedTurn.toFixed(1)}°, GS actual: ${gsSmooth.toFixed(1)} kt`;

  if (accumulatedTurn >= 350) {
    const viento = (maxGs - minGs) / 2;
    const windFrom = (trackMinGs + 180) % 360;
    const windDir = Math.round(windFrom);
    const altFt = Math.round(altAvg * 3.28084);

    resultEl.innerHTML = `
      ${altFt} ft: ${viento.toFixed(1)} kt desde ${windDir}°`;

    accumulatedTurn = 0;
    maxGs = -Infinity;
    minGs = Infinity;
  }
}

document.getElementById('windToggle').addEventListener('change', e => {
  active = e.target.checked;
  if (!active) {
    statusEl.textContent = 'Sacar Vientos desactivado';
    resultEl.innerHTML = '';
  }
});

if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(processPosition, 
    err => statusEl.textContent = `Error GPS: ${err.message}`,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
} else {
  statusEl.textContent = 'Geolocalización no soportada en este navegador';
}
