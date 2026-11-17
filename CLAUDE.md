# Car Nav

Lightweight car navigation app using OpenStreetMap + Leaflet. No API key needed.

## Architecture

- `app.js` -- UI wiring, preferences, recent destinations, toast notifications.
- `map.js` -- Leaflet map, Nominatim place search, OSRM routing, turn-by-turn navigation.
- `style.css` -- Dark theme, mobile-first, driving-friendly large touch targets.

## Services Used (all free, no API key)

- **Leaflet** -- map rendering library (CDN)
- **CartoDB Dark Matter** -- dark map tiles
- **Esri World Imagery** -- satellite tiles
- **Nominatim** -- place search (OpenStreetMap)
- **OSRM** -- routing/directions (demo server)

## Local Development

```
python -m http.server 3004 --bind 127.0.0.1
```

## Script Load Order

`app.js` -> `map.js` (map.js depends on app.js globals)

## Notes

- OSRM demo server is for personal/development use. For production traffic, deploy your own OSRM instance.
- Nominatim has a usage policy: max 1 request/second, include a valid User-Agent. The 400ms debounce on search handles this.
- Avoid tolls/highways/ferries preferences are stored but OSRM's public demo doesn't support them. A custom OSRM instance with custom profiles would.
