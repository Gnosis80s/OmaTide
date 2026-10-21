# Omarchy Tide

A searchable tide bar widget for [Omarchy](https://omarchy.org/).

Adds a tide pill to the bar with a mini water gauge (current level between LOW
and HIGH) beside the next high/low time (▲/▼). Hovering the pill shows the
current state at a glance — location, rising/falling, and the present level.
Opening the pill rows out a panel with:

- **Headline** — the place, whether the tide is rising or falling, and a
  countdown to the next high or low ("LOW IN 4H 21M").
- **Tide phase** — a rolling 6 h back / 18 h ahead wave of the water level
  with a NOW marker, ▲/▼ badges on each high and low, a height scale, and a
  LOW→HIGH water gauge showing how full the tide is right now.
- **Coming up** — the next four high/low tides with day (Today / Tmrw /
  weekday), time and level. Heights get two decimals on coasts with a small
  tidal range so readings stay distinct.
- **Daylight** — the day's sun arc with dashed sunrise/sunset hairlines (times
  read straight off the chart) and a dot marking the sun's position right now.
  Also shown: night shading outside the daylight window, and how long is left
  in daylight (or, after dark, how long until daylight). The arc spans one
  local day *at the picked location*, and every time shown is that place's own
  wall clock — the desktop's timezone is never applied.
- **Moon phase** (footer) — a drawn lunar disc (lit side facing the sun, waxing right,
  waning left) with phase, % lit, and age alongside.

All times — tides and daylight alike — are the picked place's own wall
clock. When that differs from the desktop's timezone, the panel says so under
the location name ("TIMES UTC+2").

A live location search picks any coastal place. The pick resolves to the
nearest published tide reference station via the Open Waters tide API
(api.openwaters.io); sunrise and sunset come from Open-Meteo
(api.open-meteo.com). Everything is cached per location so the panel works
offline.

## Preview

The expanded panel on the bar (Whitley Bay, UK):

![Omarchy Tide expanded panel](tide-panel.png)

## Install

Requires an Omarchy system (Hyprland + the Omarchy shell).

```sh
omarchy plugin add https://github.com/Gnosis80s/OmarchyTide.git --enable
```

The command clones the repo, validates it against the Omarchy plugin schema,
installs it to `~/.config/omarchy/plugins/gnosis.tide/`, and places it in
the center of the bar. The bar hot-reloads; no shell restart is needed.

Not on the bar after all? Enable it manually:

```sh
omarchy plugin enable gnosis.tide --section center
```

## Usage

- **Left click** on the pill: open/close the tide panel.
- **Middle click**: refresh the tide data.
- **Hover** the pill: peek at the current state (location · rising/falling ·
  level · time to the next high/low).
- In the panel, click the location to search; pick a suggestion to load that
  place. The chosen location persists across restarts.

## Notes

- The first time you open the panel you'll be asked to pick a location —
  search for your nearest coastal town.
- Coordinates and station are resolved per location; an inland pick resolves
  to the closest tide station, so results describe the nearest coast.
- Requires `curl`, `bash`, and GNU `date` (all standard on Arch), plus network
  access to `api.openwaters.io` (tides) and `api.open-meteo.com` (geocoding and
  sunrise/sunset) at least once for fresh data.
- Data is cached to `~/.local/state/omarchy/settings/gnosis-tide-<location>-<coords>-*.json`
  and the location to `gnosis-tide-location.json` for offline use. The footer
  shows how fresh the data is ("UPDATED 3M AGO", or "CACHED DATA" offline).
- The bar pill and panel accent colors follow your active Omarchy theme.

## Layout

```
gnosis.tide/
├── manifest.json     # Plugin manifest (id, entry point, bar-widget metadata)
├── BarWidget.qml     # Bar pill: mini gauge + next event time + hover tooltip
├── Panel.qml         # Popup: location search, tide wave, gauge, daylight arc, coming up, moon
├── Model.js          # Tide API parsing, geocoding, interpolation, sun times
└── test/             # Model.js unit tests
```

## Development

`Model.js` has no shell dependencies, so its logic is tested with Node:

```sh
node --test test/
```
