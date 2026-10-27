"use strict";

// ===========================================================================
// Konstanten & Mathematik
// ===========================================================================
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const REFRACTION = 0.833;         // Refraktion + halber Sonnendurchmesser (Grad)
const EARTH_R = 6371;             // Erdradius in km
const SAMPLES = 900;              // Stützpunkte über die Gesamtstrecke
const CLIMB_RATE_M_PER_MIN = 304.8; // Steigen/Sinken: 1000 ft pro Minute

/**
 * Horizontabsenkung (Grad) durch die Flughöhe: Je höher der Beobachter,
 * desto tiefer liegt der sichtbare Horizont unter der Waagerechten.
 * @param altM Flughöhe in Metern
 */
function horizonDip(altM) {
  const R = 6371000;              // Erdradius in m
  if (altM <= 0) return 0;
  return Math.acos(R / (R + altM)) * DEG;
}

/** Effektiver Horizontwinkel (Grad) für Sonnenauf-/untergang in Flughöhe. */
function horizonAt(altM) {
  return -(REFRACTION + horizonDip(altM));
}

/**
 * Parst eine Flughöhenangabe und liefert Meter zurück.
 * Unterstützt: FL380, 380 (=> FL), 38000 ft / feet, 11300 m, 11.3 km.
 */
function parseAltitude(text) {
  const s = String(text).trim().toUpperCase().replace(",", ".");
  if (!s) throw new Error("Bitte eine Flughöhe angeben (z. B. FL380).");
  let m = s.match(/^FL\s*(\d+(?:\.\d+)?)$/);
  if (m) return parseFloat(m[1]) * 100 * 0.3048;
  m = s.match(/^(\d+(?:\.\d+)?)\s*KM$/);
  if (m) return parseFloat(m[1]) * 1000;
  m = s.match(/^(\d+(?:\.\d+)?)\s*(M|FT|FEET)?$/);
  if (m) {
    const v = parseFloat(m[1]);
    const unit = m[2] || (v <= 500 ? "FL" : "FT");
    if (unit === "M") return v;
    if (unit === "FL") return v * 100 * 0.3048;
    return v * 0.3048;            // FT/FEET
  }
  throw new Error(`Flughöhe "${text}" nicht verstanden – z. B. FL380, 38000 ft oder 11300 m.`);
}

/**
 * Baut die Liste der Flughöhenwechsel-Segmente (1000 ft/min).
 * changes: [{ tMs, altM, altText }] – nach Startzeit sortiert.
 * Jedes Segment: { tMs, from, to, durMs, altText }.
 */
function buildAltSegments(baseAltM, changes) {
  const segs = [];
  let prev = baseAltM;
  for (const ch of changes) {
    const durMs = (Math.abs(ch.altM - prev) / CLIMB_RATE_M_PER_MIN) * 60000;
    segs.push({ tMs: ch.tMs, from: prev, to: ch.altM, durMs, altText: ch.altText });
    prev = ch.altM;
  }
  return segs;
}

/**
 * Flughöhe (Meter) zum Zeitpunkt tMs:
 * konstant zwischen Wechseln, während eines Wechsels linear (1000 ft/min).
 */
function altitudeAtT(tMs, baseAltM, segs) {
  let alt = baseAltM;
  for (const s of segs) {
    if (tMs >= s.tMs + s.durMs) alt = s.to;
    else if (tMs >= s.tMs) {
      return s.durMs > 0 ? s.from + (s.to - s.from) * ((tMs - s.tMs) / s.durMs) : s.to;
    }
  }
  return alt;
}

const $ = (id) => document.getElementById(id);
const mod360 = (x) => ((x % 360) + 360) % 360;
const jdOf = (ms) => ms / 86400000 + 2440587.5;

/** Sonnenhöhe (Altitude) in Grad – NOAA-Algorithmus, Genauigkeit ca. 0,01°. */
function sunAltitude(jd, latDeg, lonDeg) {
  const n = jd - 2451545.0;
  const L = mod360(280.46 + 0.9856474 * n);          // mittlere ekliptikale Länge
  const g = mod360(357.528 + 0.9856003 * n) * RAD;   // mittlere Anomalie
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;        // Schiefe der Ekliptik
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));            // Deklination
  const raDeg = mod360(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * DEG);
  const gmst = mod360(280.46061837 + 360.98564736629 * n);             // Sternzeit Greenwich
  const H = (gmst + lonDeg - raDeg) * RAD;                             // Stundenwinkel
  return Math.asin(
    Math.sin(latDeg * RAD) * Math.sin(dec) +
    Math.cos(latDeg * RAD) * Math.cos(dec) * Math.cos(H)
  ) * DEG;
}

// --- Großkreis-Geometrie ---
function toVec(latDeg, lonDeg) {
  const lat = latDeg * RAD, lon = lonDeg * RAD;
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
}
function vecToLatLon(v) {
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, v.z))) * DEG,
    lon: Math.atan2(v.y, v.x) * DEG,
  };
}
/** Position auf dem Großkreis zwischen A und B zum Anteil f (0..1). */
function slerp(lat1, lon1, lat2, lon2, f) {
  const a = toVec(lat1, lon1), b = toVec(lat2, lon2);
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  if (omega < 1e-10) return { lat: lat1, lon: lon1 };
  const s = Math.sin(omega);
  const k1 = Math.sin((1 - f) * omega) / s, k2 = Math.sin(f * omega) / s;
  return vecToLatLon({ x: k1 * a.x + k2 * b.x, y: k1 * a.y + k2 * b.y, z: k1 * a.z + k2 * b.z });
}
function gcDistance(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

// ===========================================================================
// Wegpunkt-Datenbank (aus waypoints.js, generiert von tools/build-waypoints.ps1)
// Format der Rohdaten: IDENT;TYP;LAT;LON[;NAME]
// ===========================================================================
let db = null;
let sortedIdents = null;

function getDB() {
  if (db) return db;
  db = new Map();
  const raw = (typeof WAYPOINT_DB_RAW === "string" ? WAYPOINT_DB_RAW : "");
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const p = line.split(";");
    if (p.length < 4) continue;
    const lat = parseFloat(p[2]), lon = parseFloat(p[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !p[0]) continue;
    const entry = { lat, lon, typ: p[1], name: p.slice(4).join(";") };
    const arr = db.get(p[0]);
    if (arr) arr.push(entry);
    else db.set(p[0], [entry]);
  }
  return db;
}

function getSortedIdents() {
  if (!sortedIdents) sortedIdents = [...getDB().keys()].sort();
  return sortedIdents;
}

/** Alle Idents, die mit dem Präfix beginnen (binäre Suche). */
function prefixMatches(prefix, limit) {
  const arr = getSortedIdents();
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < prefix) lo = mid + 1; else hi = mid;
  }
  const res = [];
  for (let i = lo; i < arr.length && res.length < limit; i++) {
    if (arr[i].startsWith(prefix)) res.push(arr[i]);
    else break;
  }
  return res;
}

const TYPE_NAMES = { F: "Fix", V: "VOR", N: "NDB", T: "TACAN", A: "Flughafen" };
const typeLabel = (e) => TYPE_NAMES[e.typ] || e.typ;

// ===========================================================================
// Koordinaten-Parser (Formaterkennung)
// ===========================================================================

/**
 * Parst eine einzelne Koordinaten-Hälfte ("N 52° 22.3'", "4°32'48\"E", "-4.5", "52 22.3" ...).
 * Rückgabe: { val, axis: 'lat'|'lon'|null } oder null.
 */
function parseChunk(t) {
  t = t.trim();
  const m = t.match(
    /^([NSEWO])?\s*([+-])?\s*(\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′]?\s*)?(?:(\d+(?:\.\d+)?)\s*["″]?\s*)?([NSEWO])?$/
  );
  if (!m) return null;
  const hemi1 = m[1] || "", hemi2 = m[6] || "";
  if (hemi1 && hemi2 && hemi1 !== hemi2) return null; // zwei Hemisphären -> ungültig
  const hemi = hemi1 || hemi2;
  const deg = parseFloat(m[3]);
  const min = m[4] !== undefined ? parseFloat(m[4]) : 0;
  const sec = m[5] !== undefined ? parseFloat(m[5]) : 0;
  if (min >= 60 || sec >= 60) return null;
  let val = deg + min / 60 + sec / 3600;
  if (/[SW]/.test(hemi) || m[2] === "-") val = -val;
  let axis = null;
  if (/[NS]/.test(hemi)) axis = "lat";
  else if (/[EWO]/.test(hemi)) axis = "lon";
  return { val, axis };
}

/** Ordnet zwei Koordinaten-Hälften Breite/Länge zu und prüft die Wertebereiche. */
function combineChunks(c1, c2) {
  let lat = null, lon = null;
  const ax1 = c1.axis, ax2 = c2.axis;
  if (ax1 === "lat" && ax2 === "lon") { lat = c1.val; lon = c2.val; }
  else if (ax1 === "lon" && ax2 === "lat") { lat = c2.val; lon = c1.val; }
  else if (!ax1 && !ax2) {
    // Standard: erste Zahl = Breite; falls > 90, Reihenfolge tauschen
    if (Math.abs(c1.val) <= 90) { lat = c1.val; lon = c2.val; }
    else if (Math.abs(c2.val) <= 90) { lat = c2.val; lon = c1.val; }
    else return null;
  } else if (ax1 === "lat") { lat = c1.val; lon = c2.val; }
  else if (ax1 === "lon") { lon = c1.val; lat = c2.val; }
  else if (ax2 === "lat") { lat = c2.val; lon = c1.val; }
  else { lon = c2.val; lat = c1.val; }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Erkennt Koordinaten in beliebigem Format und gibt { lat, lon } zurück, sonst null.
 * Unterstützt: Dezimalgrad, Grad/Minuten, Grad/Minuten/Sekunden,
 * N/S/E/W/O-Präfix oder -Suffix, Vorzeichen, Dezimalkomma, diverse Trennzeichen.
 */
function parseCoordinate(str) {
  let s = String(str).trim().toUpperCase();
  if (!s || !/\d/.test(s)) return null;

  // Ganze-Grad-Marker (Notation der Wegpunkt-Datenbank): DDPPX
  // z. B. 3030N = 30°N 30°W, 3015N = 30°N 15°W, 0348E = 3°N 48°O,
  // 3015S = 30°S 15°O, 0710W = 7°S 10°W. Buchstabe = Quadrant:
  // N = Nordbreite/Westlänge, E = Nordbreite/Ostlänge,
  // S = Südbreite/Ostlänge, W = Südbreite/Westlänge.
  let m = s.match(/^(\d{2})(\d{2,3})([NSEW])$/);
  if (m) {
    const lat = parseInt(m[1], 10), lon = parseInt(m[2], 10), q = m[3];
    if (lat <= 90 && lon <= 180) {
      return {
        lat: (q === "N" || q === "E") ? lat : -lat,
        lon: (q === "E" || q === "S") ? lon : -lon,
      };
    }
    return null;
  }

  // ICAO/NOTAM-Format mit Minuten (auch verkürzt):
  // 5130N00830E = 51°30'N 008°30'O · 5130N008E · 51N00830E · 51N8E
  m = s.match(/^(\d{2})(\d{2})?([NS])[\s,]*(\d{1,3})(\d{2})?([EOW])$/);
  if (m) {
    const latDeg = parseInt(m[1], 10);
    const latMin = m[2] ? parseInt(m[2], 10) : 0;
    const lonDeg = parseInt(m[4], 10);
    const lonMin = m[5] ? parseInt(m[5], 10) : 0;
    if (latMin < 60 && lonMin < 60 && latDeg <= 90 && lonDeg <= 180) {
      let lat = latDeg + latMin / 60;
      let lon = lonDeg + lonMin / 60;
      if (m[3] === "S") lat = -lat;
      if (m[6] === "W") lon = -lon;
      return { lat, lon };
    }
    return null;
  }

  s = s.replace(/[\u2019\u2032\u00B4`]/g, "'");
  s = s.replace(/[\u2033\u201D]/g, '"');
  s = s.replace(/(\d),(\d)/g, "$1.$2");          // Dezimalkomma -> Punkt
  s = s.replace(/([NSEWO])(?=[\d+°])/g, "$1 "); // "N52" -> "N 52"
  s = s.replace(/(\d)([NSEWO])(?![A-Z\d])/g, "$1 $2"); // "18N" -> "18 N"

  const sepIdx = s.search(/[;,]/);
  if (sepIdx >= 0) {
    const c1 = parseChunk(s.slice(0, sepIdx));
    const c2 = parseChunk(s.slice(sepIdx + 1));
    return (c1 && c2) ? combineChunks(c1, c2) : null;
  }
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  for (let i = 1; i < tokens.length; i++) {
    const c1 = parseChunk(tokens.slice(0, i).join(" "));
    if (!c1) continue;
    const c2 = parseChunk(tokens.slice(i).join(" "));
    if (c2) {
      const res = combineChunks(c1, c2);
      if (res) return res;
    }
  }
  return null;
}

// ===========================================================================
// Formatierung
// ===========================================================================
const pad = (n) => String(n).padStart(2, "0");

function fmtUTC(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
function fmtHMUTC(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function fmtMeanLocal(ms, lonDeg) {
  const local = new Date(ms + (lonDeg / 15) * 3600000);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} Ortszeit`;
}
function fmtDuration(min) {
  return `${Math.floor(min / 60)} h ${pad(Math.round(min % 60))} min`;
}
function fmtCoord(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "O" : "W"}`;
}
/** UTC-Uhrzeit (HH:MM) als Millisekunden des Tages. */
function utcToTimeValue(msOfDay) {
  const d = new Date(msOfDay);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** Parst ein Abflugdatum (JJJJ-MM-TT) zu UTC-Mitternacht. */
function parseDepDate(value) {
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("Bitte ein Abflugdatum angeben.");
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
/** Parst eine Uhrzeit (HH:MM) zu Millisekunden des Tages. */
function parseTimeOfDayMs(value, label) {
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Bei ${label}: bitte eine Uhrzeit (HH:MM, UTC) angeben.`);
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) throw new Error(`Bei ${label}: ungültige Uhrzeit.`);
  return (h * 60 + mi) * 60000;
}
/**
 * Verrechnet Abflugdatum + Uhrzeit zu einem UTC-Zeitstempel.
 * Liegt die Uhrzeit vor der Abflugzeit, liegt sie am Folgetag (Flug < 24 h).
 */
function combineDateAndTime(depDateMs, todMs, anchorTodMs) {
  let tMs = depDateMs + todMs;
  if (todMs < anchorTodMs) tMs += 86400000;
  return tMs;
}

// ===========================================================================
// Flugsimulation über mehrere Abschnitte
// ===========================================================================
/**
 * wps: [{ lat, lon, tMs, ... }] mit streigenden UTC-Zeiten.
 * Rückgabe: { startMs, endMs, legs, samples, events, maxAlt, altAtStart, altAtEnd }
 * events: { type: 'sunrise'|'sunset', tMs, lat, lon }
 */
function simulate(wps, baseAltM, altSegs) {
  const startMs = wps[0].tMs, endMs = wps[wps.length - 1].tMs;
  const legs = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    legs.push({
      a, b,
      durMs: b.tMs - a.tMs,
      dist: gcDistance(a.lat, a.lon, b.lat, b.lon),
    });
  }

  const posAt = (tMs) => {
    if (tMs >= endMs) return { lat: wps[wps.length - 1].lat, lon: wps[wps.length - 1].lon };
    for (const l of legs) {
      if (tMs >= l.a.tMs && tMs < l.b.tMs) {
        return slerp(l.a.lat, l.a.lon, l.b.lat, l.b.lon, (tMs - l.a.tMs) / l.durMs);
      }
    }
    return { lat: wps[0].lat, lon: wps[0].lon };
  };
  const altAt = (tMs) => {
    const p = posAt(tMs);
    return sunAltitude(jdOf(tMs), p.lat, p.lon);
  };
  // Horizontwinkel folgt der Flughöhe (konstant bzw. linear im Wechsel mit 1000 ft/min)
  const horizonAtT = (tMs) => horizonAt(altitudeAtT(tMs, baseAltM, altSegs));

  // Stützpunkte abschnittweise + zusätzliche Punkte an den Flughöhenwechseln
  const samples = [];
  let maxAlt = -Infinity;
  const pushSample = (tMs) => {
    if (tMs < startMs || tMs > endMs) return;
    samples.push({ tMs, alt: altAt(tMs), horizon: horizonAtT(tMs) });
  };
  for (const l of legs) {
    const n = Math.max(8, Math.round(SAMPLES * l.durMs / (endMs - startMs)));
    for (let i = 0; i < n; i++) {
      pushSample(l.a.tMs + (l.durMs * i) / n);
    }
  }
  for (const s of altSegs) {
    pushSample(s.tMs);
    pushSample(s.tMs + s.durMs);
    for (let k = 1; k < 8; k++) pushSample(s.tMs + (s.durMs * k) / 8);
  }
  pushSample(endMs);
  samples.sort((a, b) => a.tMs - b.tMs);
  for (const s of samples) if (s.alt > maxAlt) maxAlt = s.alt;

  // Nulldurchgänge (Sonnenhöhe = Horizont) per Bisektion verfeinern
  const events = [];
  const g = (tMs) => altAt(tMs) - horizonAtT(tMs);
  for (let i = 1; i < samples.length; i++) {
    const g0 = samples[i - 1].alt - samples[i - 1].horizon;
    const g1 = samples[i].alt - samples[i].horizon;
    if ((g0 <= 0 && g1 > 0) || (g0 >= 0 && g1 < 0)) {
      let lo = samples[i - 1].tMs, hi = samples[i].tMs, flo = g0;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2, fm = g(mid);
        if ((flo <= 0) === (fm <= 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      const tMs = (lo + hi) / 2;
      const pos = posAt(tMs);
      events.push({ type: g1 > g0 ? "sunrise" : "sunset", tMs, lat: pos.lat, lon: pos.lon, horizon: horizonAtT(tMs) });
    }
  }

  return {
    startMs, endMs, legs, wps, samples, events, maxAlt, baseAltM, altSegs,
    altAtStart: samples[0].alt, altAtEnd: altAt(endMs), posAt, altAt, horizonAtT,
  };
}

// ===========================================================================
// Chart
// ===========================================================================
function drawChart(sim) {
  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const padL = 46, padR = 14, padT = 28, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const yMin = -70, yMax = 90;
  const xOf = (tMs) => padL + ((tMs - sim.startMs) / (sim.endMs - sim.startMs)) * plotW;
  const yOf = (alt) => padT + ((yMax - alt) / (yMax - yMin)) * plotH;

  ctx.clearRect(0, 0, W, H);

  // Tag/Nacht-Hintergrund
  for (let i = 0; i < sim.samples.length - 1; i++) {
    const s = sim.samples[i];
    ctx.fillStyle = s.alt > s.horizon ? "rgba(255, 200, 90, 0.22)" : "rgba(25, 30, 70, 0.55)";
    const x0 = xOf(s.tMs), x1 = xOf(sim.samples[i + 1].tMs);
    ctx.fillRect(x0, padT, x1 - x0 + 1, plotH);
  }

  // Gitter & Achsen
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.textAlign = "right";
  for (let a = -60; a <= 90; a += 30) {
    const y = yOf(a);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = "#9aa4c7";
    ctx.fillText(`${a}°`, padL - 6, y + 4);
  }
  const hourMs = 3600000;
  ctx.textAlign = "center";
  for (let t = Math.ceil(sim.startMs / hourMs) * hourMs; t <= sim.endMs; t += hourMs) {
    const x = xOf(t);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    ctx.fillStyle = "#9aa4c7";
    ctx.fillText(fmtHMUTC(t), x, H - padB + 18);
  }
  ctx.fillStyle = "#9aa4c7";
  ctx.fillText("UTC", padL + 20, H - padB + 34);

  // Horizont: folgt der Flughöhe (konstant, beim Wechsel linear mit 1000 ft/min)
  ctx.strokeStyle = "#ff5f6d";
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  sim.samples.forEach((s, i) => {
    const x = xOf(s.tMs), y = yOf(s.horizon);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Höhenkurve
  ctx.strokeStyle = "#ffb347";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  sim.samples.forEach((s, i) => {
    const x = xOf(s.tMs), y = yOf(s.alt);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.lineWidth = 1;

  // Wegpunkte (senkrechte Linien + Name statt Nummer, versetzt bei engen Abständen)
  sim.wps.forEach((wp, i) => {
    const x = xOf(wp.tMs);
    ctx.strokeStyle = "rgba(91, 140, 255, 0.55)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#5b8cff";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    const name = wp.ident || `${Math.abs(wp.lat).toFixed(0)}${wp.lat >= 0 ? "N" : "S"}/${Math.abs(wp.lon).toFixed(0)}${wp.lon >= 0 ? "O" : "W"}`;
    ctx.fillText(name, Math.max(padL + 20, Math.min(W - padR - 20, x)), padT - (i % 2 === 0 ? 6 : 19));
  });

  // Sonnenereignisse
  sim.events.forEach((ev) => {
    const x = xOf(ev.tMs), y = yOf(ev.horizon);
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = ev.type === "sunrise" ? "#ff9e5e" : "#b06cff";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    const text = `${fmtHMUTC(ev.tMs)} ${ev.type === "sunrise" ? "Sonnenaufgang" : "Sonnenuntergang"}`;
    const tx = Math.max(padL + 60, Math.min(W - padR - 70, x));
    ctx.fillText(text, tx, y + (y < H / 2 ? 26 : -16));
  });

  const legend = $("horizonLegend");
  if (legend) {
    let mn = Infinity, mx = -Infinity;
    for (const s of sim.samples) {
      if (s.horizon < mn) mn = s.horizon;
      if (s.horizon > mx) mx = s.horizon;
    }
    legend.textContent = (mx - mn < 0.05)
      ? `Horizont (${mn.toFixed(1).replace(".", ",")}°)`
      : `Horizont (${mn.toFixed(1).replace(".", ",")}° … ${mx.toFixed(1).replace(".", ",")}°)`;
  }
}

// ===========================================================================
// Karte (Weltkarte mit Flugroute, aus coastlines.js)
// ===========================================================================
function drawMap(sim) {
  const canvas = $("mapCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;

  // Equirektangular-Projektion
  const xOf = (lon) => ((lon + 180) / 360) * W;
  const yOf = (lat) => ((90 - lat) / 180) * H;

  ctx.clearRect(0, 0, W, H);

  // Ozean
  ctx.fillStyle = "#0d1330";
  ctx.fillRect(0, 0, W, H);

  // Landmassen
  const coasts = (typeof COASTLINES === "object" && COASTLINES) || [];
  ctx.fillStyle = "rgba(150, 165, 200, 0.30)";
  ctx.strokeStyle = "rgba(200, 210, 235, 0.45)";
  ctx.lineWidth = 0.7;
  for (const ring of coasts) {
    if (!Array.isArray(ring)) continue;
    ctx.beginPath();
    ring.forEach((pt, i) => {
      const x = xOf(pt[0]), y = yOf(pt[1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Gitternetz alle 30°
  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.beginPath(); ctx.moveTo(xOf(lon), 0); ctx.lineTo(xOf(lon), H); ctx.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    ctx.beginPath(); ctx.moveTo(0, yOf(lat)); ctx.lineTo(W, yOf(lat)); ctx.stroke();
  }

  // Flugroute (Großkreis dicht gesampelt; Sprünge über den Antimeridian aufteilen)
  const routePoints = [];
  for (const l of sim.legs) {
    const n = 60;
    for (let i = 0; i <= n; i++) {
      routePoints.push(slerp(l.a.lat, l.a.lon, l.b.lat, l.b.lon, i / n));
    }
  }
  ctx.strokeStyle = "#ffb347";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  let penDown = false, prev = null;
  for (const p of routePoints) {
    if (prev && Math.abs(p.lon - prev.lon) > 180) penDown = false; // Antimeridian
    const x = xOf(p.lon), y = yOf(p.lat);
    if (penDown) ctx.lineTo(x, y);
    else { ctx.moveTo(x, y); penDown = true; }
    prev = p;
  }
  ctx.stroke();

  // Sonnenereignisse
  sim.events.forEach((ev) => {
    const x = xOf(ev.lon), y = yOf(ev.lat);
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = ev.type === "sunrise" ? "#ff9e5e" : "#b06cff";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Wegpunkte
  ctx.font = "bold 11px 'Segoe UI', sans-serif";
  sim.wps.forEach((wp, i) => {
    const x = xOf(wp.lon), y = yOf(wp.lat);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = "#5b8cff";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#dfe6ff";
    const name = wp.ident || `${Math.abs(wp.lat).toFixed(0)}${wp.lat >= 0 ? "N" : "S"}/${Math.abs(wp.lon).toFixed(0)}${wp.lon >= 0 ? "O" : "W"}`;
    if (x > W - 55) { ctx.textAlign = "right"; ctx.fillText(name, x - 7, y - 6); }
    else { ctx.textAlign = "left"; ctx.fillText(name, x + 7, y - 6); }
  });
}

// ===========================================================================
// UI: Wegpunkt-Zeilen
// ===========================================================================
const rows = []; // { el, input, timeEl, status, resolved, cell, chooser }
const altChangeRows = []; // { el, altEl, timeEl }

function addRow(text = "", todMs = null) {  // todMs: UTC-Uhrzeit als Millisekunden des Tages
  const idx = rows.length + 1;
  const el = document.createElement("div");
  el.className = "wp-row";
  el.innerHTML = `
    <div class="wp-num">${idx}</div>
    <div class="wp-cell">
      <input class="wp-input" type="text" placeholder="Wegpunkt (z. B. BASNO, EDDF, FRA) oder Koordinaten">
      <div class="autocomplete hidden"></div>
    </div>
    <input class="wp-time" type="time" step="60" title="UTC-Uhrzeit des Überflugs (Datum = Abflugdatum; Uhrzeit nach Mitternacht einfach als frühe Uhrzeit eintragen)">
    <button type="button" class="wp-remove" title="Wegpunkt entfernen">✕</button>
    <div class="wp-status"></div>
  `;
  $("waypointList").appendChild(el);

  const row = {
    el,
    input: el.querySelector(".wp-input"),
    timeEl: el.querySelector(".wp-time"),
    status: el.querySelector(".wp-status"),
    cell: el.querySelector(".wp-cell"),
    chooser: null,
    resolved: null,
  };
  row.input.value = text;
  if (todMs !== null) row.timeEl.value = utcToTimeValue(todMs);

  row.input.addEventListener("input", () => {
    row.resolved = null;
    hideChooser(row);
    setStatus(row, "", false);
    updateAutocomplete(row);
  });
  row.input.addEventListener("blur", () => setTimeout(() => hideAutocomplete(row), 150));
  el.querySelector(".wp-remove").addEventListener("click", () => {
    if (rows.length <= 1) return;
    el.remove();
    rows.splice(rows.indexOf(row), 1);
    renumber();
  });

  attachAutocomplete(row);
  rows.push(row);
  renumber();
  return row;
}

function renumber() {
  rows.forEach((r, i) => { r.el.querySelector(".wp-num").textContent = i + 1; });
}

function setStatus(row, msg, isError) {
  if (!msg) { row.status.innerHTML = ""; row.status.classList.remove("error"); return; }
  row.status.classList.toggle("error", !!isError);
  row.status.textContent = msg;
}

// --- Autocomplete (nur für Namenseingaben) ---
function attachAutocomplete(row) {
  const dd = row.cell.querySelector(".autocomplete");
  row._dd = dd;
  dd.addEventListener("mousedown", (e) => e.preventDefault()); // Blur nicht vor Klick
}

function updateAutocomplete(row) {
  const dd = row._dd;
  const q = row.input.value.trim().toUpperCase();
  if (q.length < 2 || !/^[A-Z0-9]+$/.test(q) || parseCoordinate(row.input.value)) {
    dd.classList.add("hidden");
    return;
  }
  const idents = prefixMatches(q, 10);
  const items = [];
  for (const ident of idents) {
    for (const e of getDB().get(ident)) items.push({ ident, e });
  }
  if (!items.length) { dd.classList.add("hidden"); return; }
  dd.innerHTML = "";
  for (const { ident, e } of items.slice(0, 12)) {
    const btn = document.createElement("button");
    btn.type = "button";
    const name = e.name ? ` – ${e.name}` : "";
    btn.textContent = `${ident} · ${typeLabel(e)}${name} · ${fmtCoord(e.lat, e.lon)}`;
    btn.addEventListener("mousedown", () => {
      row.input.value = ident;
      row.resolved = null;
      hideChooser(row);
      dd.classList.add("hidden");
      setStatus(row, "", false);
    });
    dd.appendChild(btn);
  }
  dd.classList.remove("hidden");
}

function hideAutocomplete(row) {
  if (row._dd) row._dd.classList.add("hidden");
}

// --- Mehrfachtreffer-Auswahl ---
function hideChooser(row) {
  if (row.chooser) { row.chooser.remove(); row.chooser = null; }
}

function showChooser(row, ident, entries) {
  hideChooser(row);
  const div = document.createElement("div");
  div.className = "chooser";
  div.insertAdjacentHTML("beforeend",
    `<span class="chooser-title">„${ident}" existiert mehrfach – bitte auswählen:</span>`);
  entries.forEach((e, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const name = e.name ? ` – ${e.name}` : "";
    btn.textContent = `${typeLabel(e)}${name} · ${fmtCoord(e.lat, e.lon)}`;
    btn.addEventListener("click", () => {
      row.resolved = { text: row.input.value.trim(), entry: e };
      hideChooser(row);
      $("flightForm").requestSubmit ? $("flightForm").requestSubmit() : $("flightForm").dispatchEvent(new Event("submit", { cancelable: true }));
    });
    div.appendChild(btn);
  });
  row.status.insertAdjacentElement("afterend", div);
  row.chooser = div;
}

// ===========================================================================
// Eingabe-Auflösung: Koordinaten oder Datenbank-Name
// ===========================================================================
function entryToWaypoint(e, ident) {
  return {
    lat: e.lat, lon: e.lon,
    ident,
    typ: typeLabel(e),
    name: e.name,
    label: `${ident} (${typeLabel(e)}${e.name ? " " + e.name : ""})`,
  };
}

function resolveRow(row) {
  const text = row.input.value.trim();
  if (!text) return { error: "Bitte Wegpunkt oder Koordinaten eingeben." };
  if (row.resolved && row.resolved.text === text) {
    return entryToWaypoint(row.resolved.entry, text.toUpperCase());
  }
  const ident = text.toUpperCase();

  // Ganze-Grad-Marker (z. B. 3030N): Existiert der Name als Wegpunkt in der
  // Datenbank, gewinnt der Datenbank-Eintrag – die echte Position kann vom
  // Schema abweichen (z. B. ist 3027N ein Fix bei 30°N 2°W, nicht 30°N 27°W).
  // Fehlt er in der Datenbank, wird er als Koordinate interpretiert.
  if (/^\d{2}\d{2,3}[NSEW]$/.test(ident)) {
    const entries = getDB().get(ident);
    if (entries && entries.length === 1) return entryToWaypoint(entries[0], ident);
    if (entries && entries.length > 1) return { ambiguous: { ident, entries } };
  }

  const coord = parseCoordinate(text);
  if (coord) {
    return { lat: coord.lat, lon: coord.lon, ident: null, typ: "Koordinaten", name: null,
             label: fmtCoord(coord.lat, coord.lon) };
  }
  const entries = getDB().get(ident);
  if (!entries) {
    return { error: `„${ident}" nicht gefunden. Bitte Koordinaten eingeben oder mit Autocomplete suchen.` };
  }
  if (entries.length === 1) return entryToWaypoint(entries[0], ident);
  return { ambiguous: { ident, entries } };
}

// ===========================================================================
// Formular-Auswertung
// ===========================================================================
$("flightForm").addEventListener("submit", (e) => {
  e.preventDefault();
  hideAllErrors();
  try {
    const wps = [];
    let blocked = false;

    for (const [i, row] of rows.entries()) {
      const res = resolveRow(row);
      if (res.error) {
        setStatus(row, res.error, true);
        blocked = true;
        continue;
      }
      if (res.ambiguous) {
        setStatus(row, "Mehrdeutig – bitte Treffer auswählen.", true);
        if (!row.chooser) showChooser(row, res.ambiguous.ident, res.ambiguous.entries);
        blocked = true;
        continue;
      }
      hideChooser(row);
      const label = `Wegpunkt ${i + 1}`;
      try {
        res.todMs = parseTimeOfDayMs(row.timeEl.value, label);
      } catch (err) {
        setStatus(row, err.message, true);
        blocked = true;
        continue;
      }
      setStatus(row, `✓ ${res.label}`);
      wps.push(res);
    }

    if (blocked) return;
    if (wps.length < 2) throw new Error("Bitte mindestens zwei Wegpunkte angeben.");

    // Abflugdatum + Uhrzeiten zu Zeitstempeln verrechnen.
    // Erste Zeile = Abflug; Uhrzeiten davor liegen am Folgetag (Flug < 24 h).
    const depDateMs = parseDepDate($("depDate").value);
    const anchorTodMs = wps[0].todMs;
    for (const wp of wps) {
      wp.tMs = combineDateAndTime(depDateMs, wp.todMs, anchorTodMs);
    }

    // Wegpunkte automatisch nach UTC-Zeit sortieren (Reihenfolge der Eingabe ist egal)
    const pairs = wps.map((wp, i) => ({ wp, row: rows[i] }));
    pairs.sort((a, b) => a.wp.tMs - b.wp.tMs);
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i].wp.tMs === pairs[i - 1].wp.tMs) {
        setStatus(pairs[i].row, "Dieselbe UTC-Zeit wie ein anderer Wegpunkt.", true);
        throw new Error("Zwei Wegpunkte haben dieselbe UTC-Zeit – bitte unterschiedliche Zeiten angeben.");
      }
    }
    if (pairs.some((p, i) => p.row !== rows[i])) {
      for (const p of pairs) $("waypointList").appendChild(p.row.el); // verschiebt die Zeile ans Ende
      rows.length = 0;
      for (const p of pairs) rows.push(p.row);
      renumber();
    }

    // Flughöhe beim Abflug (erster Wegpunkt)
    const baseAltM = parseAltitude($("baseAlt").value);
    if (baseAltM < 0 || baseAltM > 20000) {
      throw new Error("Bitte eine Abflug-Flughöhe zwischen 0 und 20000 m angeben.");
    }

    // Flughöhenwechsel unterwegs einlesen (leere Zeilen werden ignoriert)
    const flightStartMs = pairs[0].wp.tMs, flightEndMs = pairs[pairs.length - 1].wp.tMs;
    const changes = [];
    for (const [i, acRow] of altChangeRows.entries()) {
      const altText = acRow.altEl.value.trim();
      const timeVal = acRow.timeEl.value;
      if (!altText && !timeVal) continue;
      let altM;
      try {
        altM = parseAltitude(altText);
        if (altM < 0 || altM > 20000) throw new Error("Flughöhe zwischen 0 und 20000 m angeben.");
      } catch (err) {
        throw new Error(`Flughöhenwechsel ${i + 1}: ${err.message}`);
      }
      let tMs;
      try {
        tMs = depDateMs + parseTimeOfDayMs(timeVal, `Flughöhenwechsel ${i + 1}`);
        if (tMs < flightStartMs) tMs += 86400000; // vor Abflug => Folgetag
      } catch (err) {
        throw new Error(`Flughöhenwechsel ${i + 1}: bitte neue Flughöhe und Startzeit (UTC) angeben.`);
      }
      changes.push({ tMs, altM, altText });
    }
    changes.sort((a, b) => a.tMs - b.tMs);
    const altSegs = buildAltSegments(baseAltM, changes);
    for (let i = 0; i < altSegs.length; i++) {
      const s = altSegs[i];
      if (s.tMs < flightStartMs || s.tMs >= flightEndMs) {
        throw new Error(`Flughöhenwechsel ${i + 1} liegt außerhalb des Fluges (zwischen Start und Landung wählen).`);
      }
      if (i > 0 && s.tMs < altSegs[i - 1].tMs + altSegs[i - 1].durMs) {
        throw new Error("Flughöhenwechsel überlappen – der nächste Wechsel muss starten, nachdem der vorherige abgeschlossen ist.");
      }
    }

    const sim = simulate(pairs.map((p) => p.wp), baseAltM, altSegs);
    sim.baseAltText = $("baseAlt").value.trim();
    render(sim);
    $("results").classList.remove("hidden");
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (!$("errorBox")) {
      const box = document.createElement("div");
      box.id = "errorBox";
      box.className = "error";
      $("waypointList").insertAdjacentElement("afterend", box);
    }
    $("errorBox").textContent = err.message;
  }
});

function hideAllErrors() {
  $("errorBox")?.remove();
}

// ===========================================================================
// Ergebnisanzeige
// ===========================================================================
function render(sim) {
  const { events, wps } = sim;
  const totalMin = (sim.endMs - sim.startMs) / 60000;
  const depDay = sim.altAtStart > sim.horizonAtT(sim.startMs);
  const arrDay = sim.altAtEnd > sim.horizonAtT(sim.endMs);
  const anyDay = sim.samples.some((s) => s.alt > s.horizon);

  let summary;
  if (events.length === 0) {
    if (!anyDay) {
      summary = `<p class="big">🌙 Durchgehend Nacht</p>
        <p>Die Sonne bleibt während des gesamten Fluges unter dem Horizont
        (maximale Sonnenhöhe: ${sim.maxAlt.toFixed(1)}°).</p>`;
    } else {
      summary = `<p class="big">☀️ Durchgehend Tag</p>
        <p>Die Sonne bleibt während des gesamten Fluges über dem Horizont
        (maximale Sonnenhöhe: ${sim.maxAlt.toFixed(1)}°).</p>`;
    }
  } else {
    summary = `<p class="big">${events.length === 1 ? "1 Sonnenereignis" : `${events.length} Sonnenereignisse`} während des Fluges</p>
      <p>Start ${depDay ? "bei Tag" : "in der Nacht"}, Landung ${arrDay ? "bei Tag" : "in der Nacht"} ·
      Gesamtstrecke ${Math.round(sim.legs.reduce((s, l) => s + l.dist, 0)).toLocaleString("de-DE")} km ·
      Flugdauer ${fmtDuration(totalMin)}.</p>`;
  }
  $("summary").innerHTML = summary;

  $("events").innerHTML = events.map((ev) => {
    const isUp = ev.type === "sunrise";
    return `
      <div class="event ${isUp ? "up" : "down"}">
        <div class="icon">${isUp ? "🌅" : "🌇"}</div>
        <div>
          <div class="when">${isUp ? "Sonnenaufgang" : "Sonnenuntergang"}: ${fmtUTC(ev.tMs)}</div>
          <div class="where">${fmtMeanLocal(ev.tMs, ev.lon)} · über ${fmtCoord(ev.lat, ev.lon)}</div>
        </div>
      </div>`;
  }).join("");

  // Route: Wegpunkte & Abschnitte
  const wpRows = wps.map((wp, i) => {
    const alt = sim.altAt(wp.tMs);
    const hor = sim.horizonAtT(wp.tMs); // Horizont in der aktuellen Flughöhe
    return `<tr>
      <td>${i + 1}</td>
      <td class="mono">${wp.ident || "–"}</td>
      <td>${wp.ident ? `${wp.typ}${wp.name ? " " + wp.name : ""}` : wp.label}</td>
      <td>${fmtHMUTC(wp.tMs)} UTC</td>
      <td>${fmtCoord(wp.lat, wp.lon)}</td>
      <td>${alt > hor ? "☀️" : "🌙"} ${alt.toFixed(1)}°</td>
    </tr>`;
  }).join("");
  const legRows = sim.legs.map((l, i) => {
    const speed = l.durMs > 0 ? (l.dist / (l.durMs / 3600000)) : 0;
    return `<tr>
      <td>${i + 1} → ${i + 2}</td>
      <td>${Math.round(l.dist).toLocaleString("de-DE")} km</td>
      <td>${fmtDuration(l.durMs / 60000)}</td>
      <td>${Math.round(speed).toLocaleString("de-DE")} km/h</td>
    </tr>`;
  }).join("");

  // Flugprofil: Basisflughöhe + Wechsel (1000 ft/min)
  const profileRows = [`<tr><td>ab Start</td><td>${sim.baseAltText}</td><td>konstant</td></tr>`];
  for (const s of sim.altSegs) {
    const durMin = s.durMs / 60000;
    profileRows.push(`<tr>
      <td>ab ${fmtHMUTC(s.tMs)} UTC</td>
      <td>${s.altText}</td>
      <td>${fmtDuration(durMin)} (1000 ft/min)</td>
    </tr>`);
  }

  $("routeInfo").innerHTML = `
    <table class="stats-table">
      <tr><th>#</th><th>Ident</th><th>Wegpunkt</th><th>Überflug (UTC)</th><th>Position</th><th>Sonne</th></tr>
      ${wpRows}
    </table>
    <h3 style="margin-top:1.2rem">Abschnitte</h3>
    <table class="stats-table">
      <tr><th>Abschnitt</th><th>Distanz</th><th>Dauer</th><th>Ø-Geschwindigkeit</th></tr>
      ${legRows}
    </table>
    <h3 style="margin-top:1.2rem">Flugprofil</h3>
    <table class="stats-table">
      <tr><th>Gültig ab</th><th>Flughöhe</th><th>Wechsel</th></tr>
      ${profileRows.join("")}
    </table>`;

  drawChart(sim);
  drawMap(sim);
}

// ===========================================================================
// Start
// ===========================================================================
function addAltChangeRow() {
  const el = document.createElement("div");
  el.className = "ac-row";
  el.innerHTML = `
    <input class="ac-alt" type="text" placeholder="Neue Flughöhe (z. B. FL340, 34000 ft, 10300 m)">
    <input class="ac-time" type="time" step="60" title="UTC-Uhrzeit, zu der der Wechsel beginnt">
    <button type="button" class="wp-remove" title="Flughöhenwechsel entfernen">✕</button>
  `;
  $("altChangeList").appendChild(el);
  const row = {
    el,
    altEl: el.querySelector(".ac-alt"),
    timeEl: el.querySelector(".ac-time"),
  };
  el.querySelector(".wp-remove").addEventListener("click", () => {
    el.remove();
    altChangeRows.splice(altChangeRows.indexOf(row), 1);
  });
  altChangeRows.push(row);
  row.altEl.focus();
}

$("addAltChange").addEventListener("click", addAltChangeRow);

$("addWaypoint").addEventListener("click", () => {
  const last = rows[rows.length - 1];
  let todMs = null;
  if (last && last.timeEl.value) {
    try { todMs = (parseTimeOfDayMs(last.timeEl.value, "letzter Wegpunkt") + 2 * 3600000) % 86400000; }
    catch (_) { /* leer lassen */ }
  }
  addRow("", todMs);
  rows[rows.length - 1].input.focus();
});

// Startlayout: Frankfurt -> New York als Ausgangspunkt, Abflug morgen 08:00 UTC
{
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + 1);
  const ymd = `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
  $("depDate").value = ymd;
  addRow("EDDF", 8 * 3600000);
  addRow("KJFK", 16.5 * 3600000);
}

// ===========================================================================
// Service Worker (Offline-App; funktioniert nur über HTTPS oder localhost)
// ===========================================================================
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  try {
    navigator.serviceWorker.register("sw.js").catch(() => { /* Datei:// oder Fehler: still ok */ });
  } catch (_) { /* ältere Browser: still ok */ }
}
