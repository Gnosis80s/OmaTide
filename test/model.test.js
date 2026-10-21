// Unit tests for Model.js. Run with: node --test test/
const test = require("node:test")
const assert = require("node:assert/strict")
const M = require("../Model.js")

const HOUR = 3600 * 1000

test("formatTime reads the location's clock when an offset is given", () => {
  const ms = Date.UTC(2026, 9, 21, 12, 5)
  assert.equal(M.formatTime(ms, 2 * HOUR), "14:05")
  assert.equal(M.formatTime(ms, -5 * HOUR), "07:05")
  assert.equal(M.formatTime(ms, 0), "12:05")
})

test("formatTime falls back to the desktop clock without an offset", () => {
  const ms = Date.UTC(2026, 9, 21, 12, 5)
  const d = new Date(ms)
  const expected = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
  assert.equal(M.formatTime(ms, null), expected)
})

test("dayLabel says Today / Tmrw / weekday on the location's clock", () => {
  const now = Date.UTC(2026, 9, 21, 22, 0) // Wed 22:00 UTC
  assert.equal(M.dayLabel(now + HOUR, now, 0), "Today")
  assert.equal(M.dayLabel(now + 3 * HOUR, now, 0), "Tmrw")
  assert.equal(M.dayLabel(now + 30 * HOUR, now, 0), "Fri")
  // At UTC+3 it is already Thursday 01:00, so +1 h is still "Today".
  assert.equal(M.dayLabel(now + HOUR, now, 3 * HOUR), "Today")
})

test("heightText never shows negative zero", () => {
  assert.equal(M.heightText(-0.04), "0.0 m")
  assert.equal(M.heightText(-0.004, 2), "0.00 m")
  assert.equal(M.heightText(-0.06), "-0.1 m")
  assert.equal(M.heightText(NaN), "—")
})

test("heightDecimals uses two decimals for small tidal ranges", () => {
  assert.equal(M.heightDecimals([{ level: -0.05 }, { level: 0.12 }]), 2)
  assert.equal(M.heightDecimals([{ level: 0.4 }, { level: 4.8 }]), 1)
  assert.equal(M.heightDecimals([]), 1)
})

test("utcLabel formats whole and fractional offsets", () => {
  assert.equal(M.utcLabel(0), "UTC")
  assert.equal(M.utcLabel(2 * HOUR), "UTC+2")
  assert.equal(M.utcLabel(-3.5 * HOUR), "UTC-3:30")
})

test("locationSlug keeps same-named places apart", () => {
  const me = M.locationSlug("Portland", 43.66, -70.26)
  const or = M.locationSlug("Portland", 45.52, -122.68)
  assert.notEqual(me, or)
  assert.match(me, /^portland-[a-z0-9_]+$/)
  assert.equal(M.locationSlug(""), "nolocation")
})

test("barLabel is never empty once data has loaded", () => {
  const now = Date.UTC(2026, 9, 21, 12, 0)
  const past = [{ ms: now - HOUR, level: 1, high: true, low: false }]
  assert.equal(M.barLabel(past, now, true), "NO DATA")
  assert.equal(M.barLabel([], now, false), "…")
  const future = [{ ms: now + 5 * HOUR + 13 * 60000, level: 1, high: false, low: true }]
  assert.equal(M.barLabel(future, now, true), "5h13")
  assert.equal(M.barLabel(future, now, true, true), "▼ 5h13")
})

test("compactDuration drops hours under an hour and pads minutes", () => {
  assert.equal(M.compactDuration(42 * 60000), "42m")
  assert.equal(M.compactDuration(HOUR + 5 * 60000), "1h05")
  assert.equal(M.compactDuration(-1000), "0m")
})

test("parseSunTimes picks the location's current day", () => {
  const offset = 2 * 3600
  const day1Rise = Date.UTC(2026, 9, 21, 5, 0) / 1000
  const raw = JSON.stringify({
    utc_offset_seconds: offset,
    daily: {
      sunrise: [day1Rise, day1Rise + 86400],
      sunset: [day1Rise + 11 * 3600, day1Rise + 86400 + 11 * 3600]
    }
  })
  const sun = M.parseSunTimes(raw, day1Rise * 1000 + 2 * HOUR)
  assert.equal(sun.rise, day1Rise * 1000)
  assert.equal(sun.nextRise, (day1Rise + 86400) * 1000)
  assert.equal(M.formatTimeAt(sun.rise, sun.offsetMs), "07:00")
})

test("daylightStatus counts down to sunset, then to the next sunrise", () => {
  const sun = { rise: 0, set: 10 * HOUR, nextRise: 24 * HOUR }
  assert.deepEqual(M.daylightStatus(sun, 4 * HOUR), { daylight: true, remainingMs: 6 * HOUR })
  assert.deepEqual(M.daylightStatus(sun, 20 * HOUR), { daylight: false, untilMs: 4 * HOUR })
})

test("flanking reports 0 at low water and 1 at high water", () => {
  const ex = [
    { ms: 0, level: 0, high: false, low: true },
    { ms: 6 * HOUR, level: 2, high: true, low: false }
  ]
  assert.equal(M.flanking(ex, HOUR, 0).fraction, 0)
  assert.equal(M.flanking(ex, HOUR, 2).fraction, 1)
  assert.equal(M.flanking(ex, HOUR, 1).rising, true)
})

test("parsePrefsFile defaults the countdown on and reads a saved choice", () => {
  assert.equal(M.parsePrefsFile("").showCountdown, true)
  assert.equal(M.parsePrefsFile("{not json").showCountdown, true)
  assert.equal(M.parsePrefsFile('{"showCountdown":false}').showCountdown, false)
  assert.equal(M.parsePrefsFile('{"showCountdown":"no"}').showCountdown, true)
})
