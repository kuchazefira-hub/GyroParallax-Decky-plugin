import { ParallaxProfile } from './profiles/presets';

export interface DebugSample {
  rawX: number;
  rawY: number;
  filteredX: number;
  filteredY: number;
  fps: number;
  available: boolean;
}

/** Small pub/sub store shared between index.tsx (which owns the overlay +
 * gyro loop) and SettingsPanel.tsx (which reads/edits it). Kept outside
 * React state on purpose - the debug sample updates every frame and we
 * don't want that driving a re-render of the whole QAM panel tree unless
 * the debug overlay is actually open. */
export class PluginState {
  currentAppId: string | null = null;
  currentProfile: ParallaxProfile | null = null;
  debugEnabled = false;
  lastDebugSample: DebugSample | null = null;
  lastRawSample: { x: number; y: number } | null = null;
  previewNudge = { x: 0, y: 0 };

  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach((fn) => fn());
  }
}
