import { ServerAPI } from 'decky-frontend-lib';
import { FilterSettings, FilterState, createFilterState, stepFilter } from './filter';
import { overscanScaleFor } from '../profiles/presets';

export interface GyroLoopLayers {
  background: HTMLElement | null;
  middle: HTMLElement | null;
  foreground: HTMLElement | null;
  logo: HTMLElement | null;
}

export interface GyroLoopOptions {
  serverAPI: ServerAPI;
  getEnabled: () => boolean;
  getSettings: () => FilterSettings;
  getCalibration: () => { x: number; y: number };
  getLayerStrengths: () => { background: number; middle: number; foreground: number; logo: number };
  getLogoExtra: () => { x: number; y: number; scale: number; depth: number };
  getLayers: () => GyroLoopLayers;
  /** Whether a game details page is currently open at all (independent of
   * the user's "Enable Parallax" toggle). Used to stop polling the backend
   * entirely while there's nothing on screen to animate. */
  getActive: () => boolean;
  onDebugSample?: (info: {
    rawX: number; rawY: number; filteredX: number; filteredY: number;
    fps: number; available: boolean;
  }) => void;
  onAvailability?: (available: boolean, reason: string | null) => void;
  /** Virtual joystick nudge (arrow buttons in the settings panel), used as
   * a stand-in raw sample so the effect can be previewed even when the
   * real gyroscope can't be read. */
  getPreviewNudge: () => { x: number; y: number };
}

const MIN_POLL_INTERVAL_MS = 1000 / 45; // backend is only asked for a new sample this often

/**
 * Starts the poll -> filter -> paint loop. Everything here mutates plain
 * objects/DOM nodes; nothing goes through React state or triggers a
 * re-render, which is what keeps this cheap enough to run continuously
 * while a game page is open.
 */
export function startGyroLoop(options: GyroLoopOptions): () => void {
  const filterState: FilterState = createFilterState();
  let stopped = false;
  let rafHandle = 0;
  let inFlight = false;
  let lastPollAt = 0;
  let lastFrameAt = performance.now();
  let fps = 0;

  async function poll() {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const res = await options.serverAPI.callPluginMethod<{}, {
        available: boolean; x: number; y: number; z: number; t: number; reason: string | null;
      }>('get_gyro_sample', {});
      if (res.success) {
        const sample = res.result;
        options.onAvailability?.(sample.available, sample.reason);
        return sample;
      }
    } catch {
      // Backend hiccup - just skip this tick, next rAF will retry.
    } finally {
      inFlight = false;
    }
    return null;
  }

  let lastSample: { available: boolean; x: number; y: number } = { available: false, x: 0, y: 0 };

  function tick() {
    if (stopped) return;
    const now = performance.now();
    const dt = now - lastFrameAt;
    lastFrameAt = now;
    if (dt > 0) fps = fps * 0.9 + (1000 / dt) * 0.1;

    // Only round-trip into the Python backend while there's actually a
    // game page open. Without this check the plugin would keep calling
    // `get_gyro_sample` ~45 times a second *forever*, including the entire
    // time the user is browsing the Steam Library or Home screen, for no
    // visible benefit (nothing is being painted while `!getActive()`).
    const active = options.getActive();
    if (active && now - lastPollAt >= MIN_POLL_INTERVAL_MS) {
      lastPollAt = now;
      poll().then((sample) => {
        if (sample) lastSample = sample;
      });
    }

    const nudge = options.getPreviewNudge();
    const usingPreview = !lastSample.available && (nudge.x !== 0 || nudge.y !== 0);
    const effectiveSample = usingPreview
      ? { available: true, x: nudge.x * 40, y: nudge.y * 40 }
      : lastSample;

    if (options.getEnabled() && effectiveSample.available) {
      const settings = options.getSettings();
      const calibration = usingPreview ? { x: 0, y: 0 } : options.getCalibration();
      const { x, y } = stepFilter(
        filterState, effectiveSample.x, effectiveSample.y, calibration.x, calibration.y, settings
      );

      const strengths = options.getLayerStrengths();
      const layers = options.getLayers();
      // The background/foreground layers also carry a dynamic "overscan"
      // scale (see profiles/presets.ts) sized to the current max
      // displacement, so panning them never reveals empty edges. That
      // scale is set once via React's `style` prop when the layer element
      // is first created (ParallaxOverlay.tsx) - but every animation frame
      // used to blow it away by overwriting `el.style.transform` with only
      // the translate3d(...) component, silently disabling the overscan
      // protection after the very first frame. Re-including `scale(...)`
      // in the same transform string on every frame keeps both effects
      // active together, and also means the overscan amount stays correct
      // live if the user changes the "Maximum displacement" slider.
      const overscan = overscanScaleFor(settings.maxDisplacement);
      const paint = (el: HTMLElement | null, strength: number, withOverscan: boolean) => {
        if (!el) return;
        const translate = `translate3d(${(x * strength).toFixed(2)}px, ${(y * strength).toFixed(2)}px, 0)`;
        el.style.transform = withOverscan ? `${translate} scale(${overscan})` : translate;
      };
      paint(layers.background, strengths.background, true);
      paint(layers.middle, strengths.middle, false);
      paint(layers.foreground, strengths.foreground, true);

      const logoExtra = options.getLogoExtra();
      if (layers.logo) {
        const lx = x * strengths.logo * logoExtra.depth + logoExtra.x;
        const ly = y * strengths.logo * logoExtra.depth + logoExtra.y;
        layers.logo.style.transform =
          `translate3d(${lx.toFixed(2)}px, ${ly.toFixed(2)}px, 0) scale(${logoExtra.scale})`;
      }

      options.onDebugSample?.({
        rawX: lastSample.x, rawY: lastSample.y, filteredX: x, filteredY: y,
        fps: Math.round(fps), available: true,
      });
    } else {
      options.onDebugSample?.({
        rawX: lastSample.x, rawY: lastSample.y, filteredX: 0, filteredY: 0,
        fps: Math.round(fps), available: lastSample.available,
      });
    }

    rafHandle = requestAnimationFrame(tick);
  }

  rafHandle = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(rafHandle);
  };
}
