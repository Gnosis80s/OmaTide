// Tide data helpers for the Omarchy tide plugin.
//
// Data comes from the Open Waters tide API (openwaters.io/tides), keyed by the
// latitude/longitude of the location the user picked in the search box. The
// API resolves to the nearest reference station with published harmonic
// constituents, so predictions hold for the chosen place. Extremes give timed
// high/low events; the timeline gives a 10-minute level series used for the
// tide curve. When the timeline is unavailable the curve is approximated by
// sine interpolation between neighbouring extremes.

function now() {
  return new Date()
}

function toMs(value) {
  if (typeof value === "number") return value
  var t = new Date(value)
  return isNaN(t.getTime()) ? NaN : t.getTime()
}

function parseExtremes(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    var list = data && data.extremes
    if (!Array.isArray(list)) return []
    var out = []
    for (var i = 0; i < list.length; i++) {
      var ms = toMs(list[i].time)
      if (isNaN(ms)) continue
      out.push({ ms: ms, level: Number(list[i].level), high: !!list[i].high, low: !!list[i].low })
    }
    out.sort(function(a, b) { return a.ms - b.ms })
    return out
  } catch (e) {
    return []
  }
}

function parseTimeline(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    var list = data && data.timeline
    if (!Array.isArray(list)) return []
    var out = []
    for (var i = 0; i < list.length; i++) {
      var ms = toMs(list[i].time)
      if (isNaN(ms)) continue
      out.push({ ms: ms, level: Number(list[i].level) })
    }
    out.sort(function(a, b) { return a.ms - b.ms })
    return out
  } catch (e) {
    return []
  }
}

function firstAfter(list, ms) {
  if (!list) return null
  for (var i = 0; i < list.length; i++) {
    if (list[i].ms > ms) return list[i]
  }
  return null
}

function firstBeforeOrAt(list, ms) {
  var last = null
  if (!list) return last
  for (var i = 0; i < list.length; i++) {
    if (list[i].ms <= ms) last = list[i]
    else break
  }
  return last
}

function nextWindow(list, ms, count) {
  var out = []
  if (!list) return out
  for (var i = 0; i < list.length && out.length < count; i++) {
    if (list[i].ms > ms) out.push(list[i])
  }
  return out
}

// Approximate height at any instant by easing sinusoidally between the two
// surrounding extremes. Only used when the live timeline is unavailable.
function levelAtSynth(list, ms) {
  if (!list || list.length === 0) return NaN
  var prev = firstBeforeOrAt(list, ms)
  var next = firstAfter(list, ms)
  if (!prev && !next) return NaN
  if (!prev) return next.level
  if (!next) return prev.level
  var span = next.ms - prev.ms
  if (span <= 0) return next.level
  var f = (ms - prev.ms) / span
  if (f < 0) f = 0
  if (f > 1) f = 1
  var d = next.level - prev.level
  return prev.level + d * (1 - Math.cos(Math.PI * f)) / 2
}

function levelAtTimeline(timeline, ms) {
  var prev = null
  for (var i = 0; i < timeline.length; i++) {
    if (timeline[i].ms <= ms) prev = timeline[i]
    else {
      var next = timeline[i]
      var span = next.ms - prev.ms
      if (span <= 0) return prev.level
      var f = (ms - prev.ms) / span
      return prev.level + (next.level - prev.level) * f
    }
  }
  return prev ? prev.level : NaN
}

// Current sea level: interpolated exactly at `ms` from the two surrounding
// timeline samples (live and smooth), else the sinusoidal estimate from
// extremes, else null.
function currentLevel(timeline, extremes, ms) {
  if (timeline && timeline.length > 1 && ms >= timeline[0].ms && ms <= timeline[timeline.length - 1].ms) {
    var prev = firstBeforeOrAt(timeline, ms)
    var next = firstAfter(timeline, ms)
    if (prev && next && next.ms > prev.ms) {
      var span = next.ms - prev.ms
      var f = Math.max(0, Math.min(1, (ms - prev.ms) / span))
      return { level: prev.level + (next.level - prev.level) * f, synced: true }
    }
    if (prev) return { level: prev.level, synced: true }
  }
  var v = levelAtSynth(extremes, ms)
  if (!isNaN(v)) return { level: v, synced: false }
  return null
}

// Rolling window for the phase chart: past and future, so the shape of the
// tide wave and where now sits on it are easy to read.
function phaseSamples(timeline, extremes, ms, hoursBack, hoursAhead) {
  var step = 15 * 60 * 1000
  var start = ms - hoursBack * 3600 * 1000
  var end = ms + hoursAhead * 3600 * 1000
  var out = []
  var useTimeline = timeline && timeline.length > 1
    && timeline[0].ms <= start
    && timeline[timeline.length - 1].ms >= end
  for (var t = start; t <= end; t += step) {
    var level = useTimeline ? levelAtTimeline(timeline, t) : levelAtSynth(extremes, t)
    if (!isNaN(level)) out.push({ ms: t, level: level, live: useTimeline })
  }
  return out
}

// Extremes that fall inside a window, for markers on the phase chart.
function extremesBetween(list, fromMs, toMs) {
  var out = []
  if (!list) return out
  for (var i = 0; i < list.length; i++) {
    if (list[i].ms >= fromMs && list[i].ms <= toMs) out.push(list[i])
  }
  return out
}

// Current level interpolated from the sample series at an exact instant.
function levelAtSamples(samples, ms) {
  if (!samples || samples.length === 0) return NaN
  if (ms <= samples[0].ms) return samples[0].level
  for (var i = 0; i < samples.length; i++) {
    if (samples[i].ms >= ms) {
      var prev = samples[i - 1] || samples[i]
      var span = samples[i].ms - prev.ms
      if (span <= 0) return samples[i].level
      var f = (ms - prev.ms) / span
      return prev.level + (samples[i].level - prev.level) * f
    }
  }
  return samples[samples.length - 1].level
}

// Position of the current level between the flanking extremes of the present
// half-cycle — the values that drive the water gauge. fraction is 0.0 at low
// water and 1.0 at high water, whether the tide is rising or falling.
function flanking(extremes, ms, level) {
  if (!extremes || extremes.length < 2 || isNaN(level)) return null
  var prev = firstBeforeOrAt(extremes, ms)
  var next = firstAfter(extremes, ms)
  if (!prev || !next) return null
  var lowLv = Math.min(prev.level, next.level)
  var highLv = Math.max(prev.level, next.level)
  var span = highLv - lowLv
  if (span <= 0) return null
  return {
    rising: next.level > prev.level,
    fraction: Math.max(0, Math.min(1, (level - lowLv) / span)),
    low: prev.level < next.level ? prev : next,
    high: prev.level < next.level ? next : prev,
    fromMs: prev.ms,
    toMs: next.ms,
    level: level
  }
}

function two(n) {
  return (n < 10 ? "0" : "") + n
}

// The UTC offset every displayed time is read in: the picked location's own
// (from the sun API) when known, else the desktop's at that instant. Tide and
// daylight times then always share one clock.
function zoneOffset(ms, offsetMs) {
  if (typeof offsetMs === "number" && !isNaN(offsetMs)) return offsetMs
  return -new Date(ms).getTimezoneOffset() * 60000
}

// "UTC+2", "UTC-3:30", "UTC" for a zone offset.
function utcLabel(offsetMs) {
  var mins = Math.round((offsetMs || 0) / 60000)
  if (mins === 0) return "UTC"
  var sign = mins < 0 ? "-" : "+"
  mins = Math.abs(mins)
  var h = Math.floor(mins / 60), m = mins % 60
  return "UTC" + sign + h + (m ? ":" + two(m) : "")
}

function formatTime(ms, offsetMs) {
  return formatTimeAt(ms, zoneOffset(ms, offsetMs))
}

function dayShort(ms, offsetMs) {
  var d = new Date(ms + zoneOffset(ms, offsetMs))
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]
}

// "Today" / "Tmrw" / weekday, relative to `nowMs` on the same clock.
function dayLabel(ms, nowMs, offsetMs) {
  var off = zoneOffset(ms, offsetMs)
  var diff = Math.round((localDayStart(ms, off) - localDayStart(nowMs, off)) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tmrw"
  return dayShort(ms, offsetMs)
}

// Two decimals where the whole tide range is small (enclosed seas, where one
// decimal flattens every reading to "0.1 m"), one elsewhere.
function heightDecimals(extremes) {
  if (!extremes || extremes.length < 2) return 1
  var lo = Infinity, hi = -Infinity
  for (var i = 0; i < extremes.length; i++) {
    var lv = extremes[i].level
    if (isNaN(lv)) continue
    if (lv < lo) lo = lv
    if (lv > hi) hi = lv
  }
  return hi - lo < 1.5 ? 2 : 1
}

function heightText(level, decimals) {
  if (level === undefined || level === null || isNaN(level)) return "—"
  var text = Number(level).toFixed(decimals === undefined ? 1 : decimals)
  // A tiny negative rounds to "-0.0"; show it as plain zero.
  if (Number(text) === 0) text = text.replace("-", "")
  return text + " m"
}

// ---- Lunar geometry (low-precision Meeus; plenty for a widget moon).

function _rad(d) { return d * Math.PI / 180 }
function _deg(r) { return r * 180 / Math.PI }
function _wrap360(d) { return ((d % 360) + 360) % 360 }

function _vec3(ra, dec) {
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
}

function _dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

function _eclToEqu(lamDeg, betDeg, epsDeg) {
  var l = _rad(lamDeg), b = _rad(betDeg), e = _rad(epsDeg)
  var cosb = Math.cos(b)
  var x = Math.cos(l) * cosb
  var y = Math.sin(l) * cosb
  var z = Math.sin(b)
  var ye = y * Math.cos(e) - z * Math.sin(e)
  var ze = y * Math.sin(e) + z * Math.cos(e)
  return { ra: Math.atan2(ye, x), dec: Math.asin(ze) }
}

// Geocentric apparent Sun. Returns RA/Dec in radians.
function _sunEquatorial(T) {
  var L = _wrap360(280.46646 + 36000.76983 * T + 0.0003032 * T * T)
  var M = _wrap360(357.52911 + 35999.05029 * T - 0.0001537 * T * T)
  var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(_rad(M))
    + (0.019993 - 0.000101 * T) * Math.sin(_rad(2 * M)) + 0.000289 * Math.sin(_rad(3 * M))
  var omega = _wrap360(125.04 - 1934.136 * T)
  var lam = _wrap360(L + C - 0.00569 - 0.00478 * Math.sin(_rad(omega)))
  var eps = _obliq(T)
  return _eclToEqu(lam, 0, eps)
}

function _obliq(T) {
  return 23.4392911 - 0.0130042 * T
}

// Geocentric apparent Moon via the low-precision lunar theory. Returns
// RA/Dec in radians.
function _moonEquatorial(T) {
  var Lp = _wrap360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T * T * T / 538841)
  var D = _wrap360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T)
  var M = _wrap360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T)
  var Mp = _wrap360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T)
  var F = _wrap360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T)
  var E = 1 - 0.002516 * T - 0.0000074 * T * T

  // [dD, dM, dMp, dF, arcsec-e6-of-degree amplitude] — principal longitude terms.
  var lterms = [
    [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314],
    [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332],
    [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322],
    [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
    [0, 1, 1, 0, -30383], [2, 0, -2, 2, 15327], [0, 0, 2, 2, -12528],
    [0, 0, -2, 2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034],
    [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888], [2, 1, 0, 0, -6766],
    [1, 0, -1, 0, -5163], [1, 0, 1, 0, 4987], [2, -1, 1, 0, 4036],
    [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665],
    [0, 1, -2, 0, -2689], [2, 0, -1, 2, -2602], [2, 0, -1, -2, 2390]
  ]
  var dLambda = 0
  for (var li = 0; li < lterms.length; li++) {
    var lt = lterms[li], m2 = Math.abs(lt[1])
    var f = 1
    if (m2 === 1) f = E
    else if (m2 >= 2) f = E * E
    dLambda += f * lt[4] * Math.sin(_rad(lt[0] * D + lt[1] * M + lt[2] * Mp + lt[3] * F))
  }

  // Principal latitude terms.
  var bterms = [
    [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870]
  ]
  var dBeta = 0
  for (var bi = 0; bi < bterms.length; bi++) {
    var bt = bterms[bi], em = Math.abs(bt[1])
    var ef = 1
    if (em === 1) ef = E
    else if (em >= 2) ef = E * E
    dBeta += ef * bt[4] * Math.sin(_rad(bt[0] * D + bt[1] * M + bt[2] * Mp + bt[3] * F))
  }

  var lam = _wrap360(Lp + dLambda / 1000000)
  var bet = dBeta / 1000000
  return _eclToEqu(lam, bet, _obliq(T))
}

// Lunar phase. The phase itself is global, so no observer coordinates are
// needed. Returns the synodic-month age in days, the illuminated fraction,
// the eight-bin phase name, and which side of the disc is lit (waxing leans
// right, waning left — the classic flat phase graphic).
function moonInfo(ms) {
  var i = typeof ms === "number" ? ms : (new Date()).getTime()

  var synodic = 29.530588853 * 24 * 3600 * 1000
  var newMoonEpoch = Date.UTC(2000, 0, 6, 18, 14, 0)
  var age = ((i - newMoonEpoch) % synodic + synodic) % synodic / synodic

  var phase = "New moon"
  if (age < 0.03 || age >= 0.97) phase = "New moon"
  else if (age < 0.22) phase = "Waxing crescent"
  else if (age < 0.28) phase = "First quarter"
  else if (age < 0.47) phase = "Waxing gibbous"
  else if (age < 0.53) phase = "Full moon"
  else if (age < 0.72) phase = "Waning gibbous"
  else if (age < 0.78) phase = "Last quarter"
  else phase = "Waning crescent"

  var jd = i / 86400000 + 2440587.5
  var T = (jd - 2451545.0) / 36525.0
  var sun = _sunEquatorial(T)
  var moon = _moonEquatorial(T)
  var S = _vec3(sun.ra, sun.dec)
  var M = _vec3(moon.ra, moon.dec)
  var cosE = _dot(S, M)

  // waxing when the moon sits east of the sun on the sky.
  var waxing = _wrap360(_deg(moon.ra) - _deg(sun.ra)) < 180
  var illumination = Math.max(0, Math.min(1, (1 - cosE) / 2))

  return {
    ageDays: age * 29.530588853,
    illumination: illumination,
    phase: phase,
    waxing: waxing
  }
}

function arrow(event) {
  return event && event.high ? "▲" : "▼"
}

function tideState(event) {
  return event ? (event.high ? "RISING" : "FALLING") : ""
}

// "5h13" / "42m" — the pill's countdown, as short as it can be and still read.
function compactDuration(ms) {
  var total = Math.max(0, Math.round(ms / 60000))
  var h = Math.floor(total / 60)
  var m = total % 60
  return h > 0 ? h + "h" + two(m) : m + "m"
}

// Pill label: time until the tide turns ("5h13"). A countdown rather than a
// clock time, so it never reads as a second clock beside the bar's own. The
// direction normally rides in the pill's gauge; `withArrow` prefixes ▲/▼ for
// when the gauge has nothing to show. Never empty: the bar hides the pill on
// an empty label, and a stale cache with no future event must still leave the
// panel reachable.
function barLabel(extremes, ms, loaded, withArrow) {
  var next = firstAfter(extremes, ms)
  if (next) return (withArrow ? arrow(next) + " " : "") + compactDuration(next.ms - ms)
  return loaded ? "NO DATA" : "…"
}

// Location state file: JSON { name, latitude, longitude }; tolerant of an
// absent or corrupt file.
function parseLocationFile(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    var name = String(data.name || "").trim()
    var lat = Number(data.latitude)
    var lon = Number(data.longitude)
    return {
      name: name,
      latitude: isNaN(lat) ? null : lat,
      longitude: isNaN(lon) ? null : lon
    }
  } catch (e) {
    return { name: "", latitude: null, longitude: null }
  }
}

// Preferences file: JSON { showCountdown }. Defaults on, and tolerant of an
// absent or corrupt file.
function parsePrefsFile(raw) {
  var prefs = { showCountdown: true }
  try {
    var data = JSON.parse(String(raw || ""))
    if (data && typeof data.showCountdown === "boolean") prefs.showCountdown = data.showCountdown
  } catch (e) {}
  return prefs
}

// Filesystem-safe slug for the per-location cache filenames. The coordinates
// are part of it so two places sharing a name (Portland, ME / Portland, OR)
// never read each other's cache.
function locationSlug(name, latitude, longitude) {
  var s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (s === "") return "nolocation"
  var lat = Number(latitude), lon = Number(longitude)
  if (latitude === null || latitude === undefined || isNaN(lat)
    || longitude === null || longitude === undefined || isNaN(lon)) return s
  var coord = (lat.toFixed(3) + "_" + lon.toFixed(3)).replace(/-/g, "m").replace(/\./g, "p")
  return s + "-" + coord
}

// Open-Meteo geocoding response → pickable rows for the search box.
function parseGeocodingResults(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    var results = data.results
    if (!results || !results.length) return []
    var out = []
    for (var i = 0; i < results.length; i++) {
      var r = results[i]
      if (!r || !r.name || r.latitude === undefined || r.longitude === undefined) continue
      var region = [r.admin1, r.country].filter(function(part) { return !!part }).join(", ")
      out.push({
        name: String(r.name),
        description: region,
        latitude: r.latitude,
        longitude: r.longitude
      })
    }
    return out
  } catch (e) {
    return []
  }
}

// Commit from the search box: only a real geocoded pick is valid, since a
// location without coordinates cannot be resolved to tides.
function locationCommit(text, suggestions, selectedIndex) {
  var choices = suggestions || []
  if (!choices.length) return { name: "", latitude: null, longitude: null }
  var index = Math.max(0, Math.min(parseInt(selectedIndex, 10) || 0, choices.length - 1))
  return choices[index]
}

// ---- Sunrise / sunset (Open-Meteo daily API).

// Requested with timeformat=unixtime, so the times arrive as absolute epoch
// seconds and utc_offset_seconds carries the location's own UTC offset. That
// keeps every instant unambiguous: the panel never has to interpret a bare
// wall-clock string in the desktop's timezone, so a place picked on the other
// side of the planet reports its own sunrise instead of one shifted by the
// machine's offset.
//
// Two days are requested so the day charted is always the *location's* current
// local day (not the desktop's), and so the sunrise following tonight's sunset
// is a published time rather than a +24 h guess.
function parseSunTimes(raw, nowMs) {
  try {
    var data = JSON.parse(String(raw || ""))
    var daily = data && data.daily
    if (!daily || !daily.sunrise || !daily.sunset) return null
    var offsetMs = Number(data.utc_offset_seconds) * 1000
    if (isNaN(offsetMs)) offsetMs = 0
    var days = []
    for (var i = 0; i < daily.sunrise.length && i < daily.sunset.length; i++) {
      var rise = dailyMs(daily.sunrise[i], offsetMs)
      var set = dailyMs(daily.sunset[i], offsetMs)
      if (isNaN(rise) || isNaN(set)) continue
      days.push({ rise: rise, set: set })
    }
    if (days.length === 0) return null
    var reference = typeof nowMs === "number" ? nowMs : now()
    var today = localDayStart(reference, offsetMs)
    var index = -1
    for (var j = 0; j < days.length; j++) {
      if (localDayStart(days[j].rise, offsetMs) === today) { index = j; break }
    }
    if (index < 0) {
      // No entry for the location's current day — the response straddled local
      // midnight, or a polar day/night left that day without a sunrise. Prefer
      // the day in progress, else the nearest entry, so a stale day is never
      // shown in place of an upcoming one.
      index = -1
      for (var k = 0; k < days.length; k++) {
        var untilNext = k + 1 < days.length ? days[k + 1].rise : Infinity
        if (days[k].rise <= reference && reference < untilNext) { index = k; break }
      }
      if (index < 0) {
        index = 0
        for (var m = 1; m < days.length; m++) {
          if (Math.abs(days[m].rise - reference) < Math.abs(days[index].rise - reference)) index = m
        }
      }
    }
    var next = days[index + 1]
    return {
      rise: days[index].rise,
      set: days[index].set,
      nextRise: next ? next.rise : null,
      offsetMs: offsetMs
    }
  } catch (e) {
    return null
  }
}

// A daily time from the response, as an absolute instant. The API is asked for
// epoch seconds, but an ISO string is accepted too: with an offset (or Z) it
// is used as-is, and without one the wall-clock fields are read as the
// *location's* — never as the desktop's. A null entry (polar night publishes no
// sunrise) yields NaN so the caller can skip the day.
function dailyMs(value, offsetMs) {
  if (value === undefined || value === null || value === "") return NaN
  if (typeof value === "number") return isNaN(value) ? NaN : value * 1000
  var text = String(value).trim()
  if (text === "" || text === "null") return NaN
  if (/^[0-9.]+$/.test(text)) return Number(text) * 1000
  var t = new Date(text)
  if (isNaN(t.getTime())) return NaN
  if (/(Z|[+-][0-9]{2}:?[0-9]{2})$/.test(text)) return t.getTime()
  // Rebuilt as if the fields were UTC, then shifted onto the location's offset.
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()) - (offsetMs || 0)
}

// Local midnight of the day containing `ms` in a zone `offsetMs` east of UTC,
// as an absolute instant. Local wall clock runs `offsetMs` ahead of UTC, so
// local midnight is the UTC instant at which (t + offsetMs) lands on a day
// boundary.
function localDayStart(ms, offsetMs) {
  var off = offsetMs || 0
  return Math.floor((ms + off) / 86400000) * 86400000 - off
}

// Wall-clock time as the location's own clock reads it, whatever the desktop's
// timezone is. Sunrise/sunset labels use this so they match the times the API
// reported for the picked place.
function formatTimeAt(ms, offsetMs) {
  if (ms === undefined || ms === null || isNaN(ms)) return "—"
  var d = new Date(ms + (offsetMs || 0))
  return two(d.getUTCHours()) + ":" + two(d.getUTCMinutes())
}

// Daylight status at an instant: whether the sun is up, and either the time
// left until sunset (daylight) or the time until the next sunrise (dark).
// Both instants come from the response already resolved to the location's own
// timezone, so the comparison is against real time, not the desktop's day.
// Before dawn the next sunrise is the same day's; after sunset it is the
// following day's published rise, falling back to rise + 24 h when the fetch
// only covered one day.
function daylightStatus(sunTimes, ms) {
  if (!sunTimes) return null
  var rise = sunTimes.rise
  var set = sunTimes.set
  if (ms >= rise && ms < set) return { daylight: true, remainingMs: set - ms }
  if (ms < rise) return { daylight: false, untilMs: rise - ms }
  var nextRise = sunTimes.nextRise === undefined || sunTimes.nextRise === null
    ? rise + 24 * 3600 * 1000
    : sunTimes.nextRise
  return { daylight: false, untilMs: nextRise - ms }
}

// "5H 12M" — a compact hours + minutes duration for the daylight readout.
function durationText(ms) {
  var total = Math.max(0, Math.round(ms / 1000))
  var h = Math.floor(total / 3600)
  var m = Math.floor((total % 3600) / 60)
  if (h > 0) return h + "H " + two(m) + "M"
  return m + "M"
}

// ---- Wind (Open-Meteo `current` block, asked for in knots).
//
// Rides on the same request as the sunrise/sunset data, so it refreshes and
// caches on the same schedule. `direction` is the meteorological one — the
// compass bearing the wind blows *from* — and the UI turns the arrow the other
// way so it points where the air is going.

// Wind older than this is not shown: a cached reply from yesterday would read
// as a live sea state.
var WIND_MAX_AGE_MS = 3 * 3600 * 1000

var COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

// Beaufort force by the top of its band in whole knots (F0 calm … F12 hurricane
// force), so a reading is compared after rounding, as the scale is published.
var BEAUFORT = [
  { max: 0, name: "Calm" },
  { max: 3, name: "Light air" },
  { max: 6, name: "Light breeze" },
  { max: 10, name: "Gentle breeze" },
  { max: 16, name: "Moderate breeze" },
  { max: 21, name: "Fresh breeze" },
  { max: 27, name: "Strong breeze" },
  { max: 33, name: "Near gale" },
  { max: 40, name: "Gale" },
  { max: 47, name: "Strong gale" },
  { max: 55, name: "Storm" },
  { max: 63, name: "Violent storm" },
  { max: Infinity, name: "Hurricane force" }
]

// A finite number, or null — Open-Meteo sends null for a field it has no value for.
function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  var n = Number(value)
  return isFinite(n) ? n : null
}

// Compass point for a bearing in degrees, 16-wind: 0 → "N", 225 → "SW".
function compassPoint(degrees) {
  var d = finiteOrNull(degrees)
  if (d === null) return ""
  var index = Math.round((((d % 360) + 360) % 360) / 22.5) % 16
  return COMPASS_POINTS[index]
}

// Beaufort force number and name for a speed in knots.
function beaufort(knots) {
  var k = finiteOrNull(knots)
  if (k === null || k < 0) return null
  var whole = Math.round(k)
  for (var force = 0; force < BEAUFORT.length; force++) {
    if (whole <= BEAUFORT[force].max) return { force: force, name: BEAUFORT[force].name }
  }
  return null
}

// The location's current wind from an Open-Meteo response: { speed, gusts,
// direction, timeMs }. Null without a usable speed and direction, or when the
// observation is older than WIND_MAX_AGE_MS at `nowMs`. Gusts may be null.
function parseWind(raw, nowMs) {
  try {
    var data = JSON.parse(String(raw || ""))
    var current = data && data.current
    if (!current) return null
    var speed = finiteOrNull(current.wind_speed_10m)
    var direction = finiteOrNull(current.wind_direction_10m)
    if (speed === null || direction === null || speed < 0) return null
    var timeMs = dailyMs(current.time, 0)
    if (isNaN(timeMs)) return null
    var gusts = finiteOrNull(current.wind_gusts_10m)
    return windCurrent({
      speed: speed,
      gusts: gusts !== null && gusts >= 0 ? gusts : null,
      direction: ((direction % 360) + 360) % 360,
      timeMs: timeMs
    }, nowMs)
  } catch (e) {
    return null
  }
}

// The wind itself while it is still fresh at `nowMs`, else null. The panel asks
// this on every clock tick, so a reading that ages out while it stays open (or
// comes off a stale cache) disappears instead of posing as current.
function windCurrent(wind, nowMs) {
  if (!wind) return null
  var reference = typeof nowMs === "number" ? nowMs : now().getTime()
  return reference - wind.timeMs > WIND_MAX_AGE_MS ? null : wind
}

// "12 kn" — whole knots, which is as fine as a wind reading is honest.
function windSpeedText(knots) {
  var k = finiteOrNull(knots)
  return k === null ? "—" : Math.round(k) + " kn"
}

if (typeof module !== "undefined") {
  module.exports = {
    now: now,
    toMs: toMs,
    parseExtremes: parseExtremes,
    parseTimeline: parseTimeline,
    firstAfter: firstAfter,
    firstBeforeOrAt: firstBeforeOrAt,
    nextWindow: nextWindow,
    currentLevel: currentLevel,
    phaseSamples: phaseSamples,
    extremesBetween: extremesBetween,
    levelAtSamples: levelAtSamples,
    flanking: flanking,
    zoneOffset: zoneOffset,
    utcLabel: utcLabel,
    formatTime: formatTime,
    dayShort: dayShort,
    dayLabel: dayLabel,
    heightDecimals: heightDecimals,
    heightText: heightText,
    moonInfo: moonInfo,
    arrow: arrow,
    tideState: tideState,
    barLabel: barLabel,
    parseLocationFile: parseLocationFile,
    parsePrefsFile: parsePrefsFile,
    locationSlug: locationSlug,
    parseGeocodingResults: parseGeocodingResults,
    locationCommit: locationCommit,
    parseSunTimes: parseSunTimes,
    dailyMs: dailyMs,
    localDayStart: localDayStart,
    formatTimeAt: formatTimeAt,
    daylightStatus: daylightStatus,
    durationText: durationText,
    compactDuration: compactDuration,
    compassPoint: compassPoint,
    beaufort: beaufort,
    parseWind: parseWind,
    windCurrent: windCurrent,
    windSpeedText: windSpeedText
  }
}
