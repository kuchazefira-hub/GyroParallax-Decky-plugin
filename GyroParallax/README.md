# Gyro Parallax (GyroParallax)

Adds a smooth, gyro-controlled 3D parallax effect to a game's details page
on Steam Deck: tilt the Deck and the background, midground, foreground and
logo shift by different amounts, creating a subtle sense of depth. It's
meant to feel like a gentle 3D card, not a camera shake.

- **Version:** v1.0.7
- **Plugin name:** GyroParallax / display name "Gyro Parallax"

### ⚠️ Current build status (maintenance pass, 2026-09)

The `src/` in this repo, the pre-built `dist/index.js` that used to ship in
the release zip, and the changelog below had drifted out of sync with each
other (three different implementations at three different stages of
development, from a project that - per the v1.0.2 note below - had never
actually been build-tested end to end). This pass:

- Fixed the plugin so it actually **builds and runs**: added the missing
  `settings.py` backend module (the plugin could not start at all before
  this), fixed broken/missing dependencies in `package.json`, fixed the
  Rollup config (JSON import + missing CSS handling), and added the
  missing `React` imports the JSX compiler needs.
- Fixed a real visual bug where the background/foreground "overscan" zoom
  (meant to stop empty edges showing while panning) was silently wiped out
  every animation frame.
- Stopped the frontend from polling the backend for a gyro sample ~45
  times a second *all the time*, including while you're nowhere near a
  game page - it's now gated to only poll while a game details page is
  actually open.
- Rebuilt `dist/index.js` from the current, now-working `src/`.

**What this build currently *is*:** the "separate floating overlay"
architecture (a `<div>` appended to `document.body`, positioned behind
Steam's own UI) - English-language settings panel, presets, calibration,
per-layer strength sliders, and a debug readout. Backend support for
custom per-layer images (`save_custom_image` / `import_custom_image` /
`list_dir` / `remove_custom_image`) exists in `main.py`, but there is
currently no UI in `SettingsPanel.tsx` to trigger it yet.

**What the changelog below describes but is *not* in this build yet:**
Russian localization, collapsible panel sections, the in-panel banner
image, the "choose an image for Middle/Foreground" file browser UI, and
applying the effect directly to Steam's own hero/logo elements instead of
a separate overlay (the "hero cloning" approach from v1.0.5). These were
real, intentional goals from earlier iterations - they're being brought
back on top of the now-working baseline one at a time, rather than in one
big, hard-to-verify jump.

### Changelog

- **v1.0.7** - Interface localized to Russian, and reorganized into three
  collapsible sections (tap the header to expand/collapse) so the panel
  isn't a wall of controls: **Настройка** (enable, preset, sensitivity, smoothing, etc.),
  **Слои** (all layer strength/opacity/image controls), and
  **Калибровка гироскопа** (calibration, no-tilt preview, and the debug
  readout, which now lives here too). All three start collapsed. Added a
  banner image (supplied by the user) at the top of the panel, embedded as a compressed
  inline WebP (~28 KB, also kept at `assets/banner_panel.webp`) so the
  plugin stays a single self-contained file. The original 2.3 MB image
  wasn't included in the package to keep the zip small.

- **v1.0.6** - Custom **Middle** and **Foreground** image layers. In the
  Layers section, *Choose Middle/Foreground image...* opens a simple
  in-panel file browser (folders + PNG/JPG/WEBP, starts in ~/Pictures or
  ~/Downloads); *Remove ... image* clears it. Each of those layers has its
  own *movement* and *opacity* sliders (Logo got an opacity slider too).
  Images chosen while a game page is open belong to that game; images
  chosen with no game open apply to every game without its own. The
  "Advanced mode" toggle is gone (layers are always available). Layers are
  clones of Steam's own hero element inserted right above it, so they use
  the same size/position; use images with the same aspect ratio as the
  hero (about 16:5.2 / 1920x620) and transparent PNGs for cut-out
  characters. Max file size 25 MB.
- **v1.0.5** - The effect is now applied directly to Steam's own hero and
  logo images on the game page (using the CSS `translate`/`scale`
  properties, reverted when you leave the page). The old separate overlay
  sat behind Steam's opaque page and could never be seen. Debug now shows a
  "Targets" line (how many hero/logo elements were found) for diagnosis.
- **v1.0.4** - Gyroscope now works the way the Deck really exposes it: the
  IMU is read from the controller's `hidraw` node (VID 28DE / PID 1205,
  found via sysfs; the same interface Steam reads, and hidraw allows
  multiple readers). The old evdev "Motion Sensors" node does not exist on
  SteamOS. Tilt is derived from the accelerometer (gravity direction), so
  it is absolute and drift-free; the neutral pose is captured
  automatically when a game page opens (or use Calibrate). The Debug panel
  now shows *why* the sensor is unavailable (`no_device`,
  `permission_denied`, `no_state_reports`, ...).
- **v1.0.3** - Fixed the real cause of the React error #130 crash when opening
  the panel: the dropdown component is `DropdownItem` in decky-frontend-lib
  (there is no `DropdownField`), so it resolved to `undefined`. Components
  are now resolved by name with plain-HTML fallbacks, and the panel is
  wrapped in an error boundary that shows a readable message instead of
  crashing the Quick Access Menu.
- **v1.0.2** - Fixed a React "Element type is invalid" crash on the QAM
  panel caused by using `decky-frontend-lib`'s `Field` component, which
  isn't reliably present under that name at runtime. Replaced it with a
  small local label/value row component that has no dependency on that
  export. This is exactly the kind of bug a real on-device test run would
  have caught immediately - see the note in *Known limitations* about
  `dist/index.js` being hand-authored without a live SteamOS environment
  to verify against.
- **v1.0.1** - Fixed `SP_REACTDOM.render is not a function` on install:
  the plugin now mounts via `ReactDOM.createRoot()` (React 18, what the
  current Steam client ships) with a fallback to the legacy `.render()`
  API, instead of assuming the older API unconditionally.
- **v1.0.0** - Initial release.

---

## Installation

1. Download `GyroParallax-v1.0.0.zip`.
2. In Decky Loader's settings, turn on **Developer Mode** if it isn't
   already on.
3. Decky Settings -> General -> **Install Plugin from ZIP** (or copy the
   zip to your Deck and use Decky's "Install from file" flow) and select
   `GyroParallax-v1.0.0.zip`.
4. Restart Decky Loader (or just re-open the Quick Access Menu). Gyro
   Parallax will appear in the plugin list with a `◇` icon.
5. Open any game's details page from your Library and tilt the Deck.

No reboot, sudo password, or system file changes are required - the plugin
only reads standard image-cache files and an input device node the `deck`
user already has permission to read.

## Using it

- Open the Quick Access Menu (`...` button) while on a game's page and
  select **Gyro Parallax** to see the full settings panel (there is a
  single panel rather than a separate mini-QAM view + full settings page -
  see *Known limitations* below for why).
- **Enable Parallax** toggles the effect on/off.
- **Profile** picks a preset (`Subtle`, `Cinematic`, `Strong`) or `Custom`
  once you start adjusting sliders yourself.
- **Sensitivity / Maximum displacement / Smoothing / Dead zone / Invert
  horizontal / Invert vertical** tune the feel directly.
- **Layers** lets you re-weight how much each of Background / Middle /
  Foreground / Logo moves relative to each other, and switch to
  **Advanced mode** if you want independent images per layer instead of
  the automatic single-image depth effect.
- **Calibrate** captures your current holding position as the neutral
  pose so the effect is centered on how you actually hold the Deck.
  **Reset Calibration** clears it back to zero offset.
- **Reset Game Profile** removes this game's saved profile so it falls
  back to your global defaults.
- **Preview** gives you four directional nudge buttons so you can see the
  effect (using whatever tuning you've set) without tilting the Deck -
  handy on the couch, in Desktop Mode, or if the gyroscope turns out to be
  unavailable on your unit.
- **Debug** shows raw/filtered gyro values, FPS, the detected app ID, and
  whether the gyroscope was found.

Settings you change while a game's page is open are saved **for that
game**. Settings changed with no game open edit your **global defaults**,
which any game without its own saved profile will use.

## What's implemented

- Two artwork modes: **Simple** (one image, plugin adds a synthetic depth
  layer + independent logo movement) and **Advanced** (separate
  background/middle/foreground/logo images).
- Automatic artwork discovery from Steam's own library-cache image files
  (hero/background, capsule, logo) for the game you're viewing, with a
  path to add custom user-supplied images per layer.
- Per-game settings profiles that auto-load/unload as you navigate, with
  a global fallback profile.
- A raw-gyro -> dead-zone -> smoothing -> sensitivity -> clamp filter
  pipeline that runs off refs/`requestAnimationFrame`, never off React
  state, and writes `transform: translate3d(...)` directly to each layer
  so painting stays cheap.
- Calibration (with a short progress readout), reset calibration, and
  reset game profile.
- Overscan scaling tied to your configured maximum displacement so panned
  edges never show empty space.
- The parallax effect is only active while a game's details page is open;
  it's fully torn down (gyro reading stopped, RAF loop cancelled) the
  moment you navigate away, and again on plugin unload.
- A debug readout and a no-gyro-required preview/nudge mode.
- Graceful degradation: if the gyroscope can't be found or opened, the
  rest of the plugin (settings, artwork, profiles) keeps working and the
  Debug panel just reports "unavailable" instead of anything crashing.

## Known limitations (please read before filing an issue)

I built and tested this plugin's *logic* thoroughly - the Python
settings/profile/calibration/artwork code and the compiled JS bundle were
both exercised with automated tests during development (persistence,
per-game fallback, calibration, artwork lookup, the raw `input_event`
parsing, a full mount/enter-game/dismount cycle of the UI bundle). What I
could **not** do, because no such environment was available while
building this, is run it inside real SteamOS Game Mode against a real
Steam Deck's actual gyroscope and Steam's live React UI. Two things in
particular are best-effort and may need a tweak on real hardware:

1. **Tilt direction / sensor access.** Tilt comes from the Deck's
   accelerometer via `/dev/hidraw*`. If the effect moves the wrong way, use
   *Invert horizontal/vertical*. If Debug shows `permission_denied`, the
   plugin user can't open the hidraw node - add `"root"` to the `flags`
   list in `plugin.json` and reinstall. `no_device` means no Deck
   controller hidraw node was found; `no_state_reports` means the node
   opened but no state reports (type 0x09) arrived.
2. **Game-page detection.** Rather than patching Steam's internal React
   component tree (fragile, undocumented, and known to break on Steam
   client updates - which is exactly the trap this project's own brief
   warned about), the plugin watches `window.location` for
   `/library/app/<id>` and shows/hides the overlay accordingly. This is
   simpler and should be far more resilient across Steam updates, but I
   could not confirm the exact URL shape against a live client, so if the
   overlay never appears, check the Debug panel's "Current game" field -
   if it always reads `none`, the URL pattern likely needs a small tweak
   in `detectAppId()`/`GAME_PAGE_RE` (top of `src/index.tsx` /
   `dist/index.js`).

Also worth knowing:

- **The "QAM panel" *is* the full settings UI.** Decky plugins don't have
  a separate full-page settings screen distinct from their Quick Access
  Menu panel by default, so rather than build two redundant UIs, every
  control lives in the one panel (it scrolls).
- **SteamGridDB integration is not included in v1.0.0**, per the original
  brief's own instruction not to let it block a solid first release. The
  architecture (a `get_artwork(appid)` call returning per-layer image
  data) is intentionally generic so a SteamGridDB-backed source can be
  added later alongside the existing Steam-library-cache lookup, without
  changing the frontend.
- **`src/` is out of date.** Since v1.0.5 all development happened directly
  in `dist/index.js`; the TypeScript in `src/` still reflects the older
  overlay design, so do **not** rebuild `dist/` from it.
- **`dist/index.js` was hand-written**, not produced by an actual
  `pnpm`/`rollup` build (this development environment had no network
  access to install the toolchain). It's plain ES2019 JavaScript that
  mirrors `src/` logic. After the v1.0.1/v1.0.2 fixes it's now tested
  against a *strict* stand-in for `decky-frontend-lib` that throws on any
  component name not independently confirmed to exist in that library
  (rather than a permissive stub that silently accepts anything, which is
  what let the v1.0.2 bug slip through the original release) - every
  branch of the settings panel (global vs. per-game, debug on/off) is
  exercised this way, plus a full mount -> enter game -> navigate away ->
  dismount cycle. This raises confidence a lot, but it's still not the
  same as running inside real SteamOS Game Mode against Valve's actual
  React tree, so please keep reporting anything that still looks wrong.
  If you have Node.js and pnpm on your own machine, running `pnpm install
  && pnpm run build` will regenerate this file from the TypeScript/React
  source and is the more future-proof path if you plan to keep
  maintaining this.
- Requires the game to already have Steam library artwork cached (i.e.
  you've viewed/scrolled past it at least once) for the automatic artwork
  lookup to find anything; otherwise the background/logo just won't show
  until you add a custom image.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Plugin doesn't appear after install | Restart Decky Loader from its own settings, or reboot to Game Mode. |
| "Gyroscope unavailable" in Debug | See axis-code note above; the rest of the plugin still works. |
| No background/logo image shows | Steam hasn't cached artwork for that game yet, or you're in Advanced mode without per-layer images set - switch to Simple mode or add custom images. |
| Effect never appears at all | Check Debug -> "Current game"; if it's always `none`, see the game-page-detection note above. |
| Effect feels jittery | Raise **Smoothing** and/or **Dead zone**. |
| Effect feels sluggish/laggy | Lower **Smoothing**. |

## Project layout

```
GyroParallax/
├── plugin.json          Decky manifest
├── package.json          pnpm metadata + build script
├── rollup.config.js       build config (only needed if you rebuild dist/)
├── tsconfig.json
├── main.py                Python backend (settings, gyro reader, artwork)
├── src/
│   ├── index.tsx          plugin entry: overlay mount, page detection, wiring
│   ├── state.ts           tiny pub/sub store shared by the panel + gyro loop
│   ├── components/
│   │   ├── ParallaxOverlay.tsx
│   │   └── SettingsPanel.tsx
│   ├── gyro/
│   │   ├── filter.ts      dead zone -> smoothing -> sensitivity -> clamp
│   │   └── useGyro.ts     poll + requestAnimationFrame + paint loop
│   ├── hooks/backend.ts   serverAPI.callPluginMethod wrapper
│   ├── profiles/presets.ts
│   └── styles/overlay.css
├── dist/index.js          compiled frontend bundle (see note above)
├── README.md
└── LICENSE
```

## License

BSD 3-Clause - see `LICENSE`.
