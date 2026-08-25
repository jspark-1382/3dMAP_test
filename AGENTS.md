# AGENTS.md

## What this repo is

Vanilla ES5 JavaScript web app: VWORLD 3D Map API 3.0 (Cesium-based XDWorld engine, loaded from CDN) + drone CSV coordinate navigation + RF coverage prediction / beam-pattern visualization. **No package.json, no build step, no bundler, no linter.** Do not look for npm scripts or run a build.

## Running

- Must serve over local HTTP (`python -m http.server 8000` or `npx http-server -p 8000`). Opening `index.html` via `file://` breaks (CORS/local-file restrictions).
- `js/config.js` is gitignored but **required** — it holds the real `VWORLD_API_KEY`. If missing/broken, copy `js/config.example.js` → `js/config.js` and fill in a key from https://dev.vworld.kr. Without a key the map loads but terrain/imagery fails with an on-screen warning.

## Architecture & wiring

- All files are ES5 IIFEs attached to globals (`CSV`, `BEAMPATTERN`, `MAIN`) — no modules, no imports. Strictly `var` only; the existing codebase uses zero `let`/`const`/arrow functions. Match this style.
- Script load order in `index.html` is load-bearing: `config.js` first (globals used later), then an inline `document.write` that injects the VWORLD engine loader (`webglMapInit.js.do?version=3.0&apiKey=...&domain=...`), then `csv.js` → `beampattern.js` → `main.js`.
- The CDN engine loads async, so `main.js` polls `window.vw && window.vw.Map` (`waitForLibrary()`). Map viewer is reached as `window.ws3d.viewer`; map instance is `new vw.Map()`.
- `index.html` references `main.js?v=5` / `beampattern.js?v=5` as manual cache-busting — bump the `v=` query when changing those files.
- Comments and UI strings are in Korean; keep new user-facing text in Korean.

## Testing

No test framework. Two standalone Node scripts:

```bash
node test/test_csv.js          # parses sample/drone_data.csv, prints results
node test/test_beampattern.js  # assert-based suite, exits 1 on failure
```

Quirks:
- `test_beampattern.js` uses `require("../js/beampattern.js")` — that works because `beampattern.js` ends with a `typeof module !== "undefined"` export guard (browser global + Node export dual-mode). Keep this guard pattern if you extract more pure-calculation logic into a new module.
- `js/csv.js` has **no module export**, so `test_csv.js` reads the file and `eval`s its source. If you add functions to `csv.js` and want them Node-testable, either add the same export guard or extend the eval-based test.
- `test_csv.js` has no assertions and always exits 0 — verify its printed output manually.
- Domain logic worth preserving: `CSV.parse(text, "normalizeBase")` subtracts the first data row's altitude so altitude becomes relative to row 1; CSV delimiter (`,`/tab/`;`) is auto-detected; coordinates are EPSG:4326.

## Reference

- `README.md` (Korean): user-facing docs. Two stale claims: its file-structure section omits `beampattern.js` and `config.example.js`, and it references a `VWORLD_ENGINE_BASE` setting in `config.js` that does not exist — the engine loader URL is hardcoded in the inline script of `index.html`.
- `js/config.js` actually defines only: `VWORLD_API_KEY`, `VWORLD_DOMAIN`, `DEFAULT_VIEW`.
