export interface ParallaxProfile {
  enabled: boolean;
  preset: 'subtle' | 'cinematic' | 'strong' | 'custom';
  sensitivity: number;
  maxDisplacement: number;
  smoothing: number;
  deadZone: number;
  invertHorizontal: boolean;
  invertVertical: boolean;
  layerStrengths: { background: number; middle: number; foreground: number; logo: number };
  logo: { x: number; y: number; scale: number; opacity: number; depth: number };
  calibration: { x: number; y: number };
  mode: 'simple' | 'advanced';
  images: Record<string, string>;
}

export const PRESET_VALUES: Record<string, Partial<ParallaxProfile>> = {
  subtle: { sensitivity: 18, maxDisplacement: 10, smoothing: 80, deadZone: 6 },
  cinematic: { sensitivity: 35, maxDisplacement: 24, smoothing: 65, deadZone: 4 },
  strong: { sensitivity: 60, maxDisplacement: 42, smoothing: 45, deadZone: 2 },
};

export const DEFAULT_PROFILE: ParallaxProfile = {
  enabled: true,
  preset: 'cinematic',
  sensitivity: 35,
  maxDisplacement: 24,
  smoothing: 65,
  deadZone: 4,
  invertHorizontal: false,
  invertVertical: false,
  layerStrengths: { background: 0.25, middle: 0.5, foreground: 0.8, logo: 1.0 },
  logo: { x: 0, y: 0, scale: 1.0, opacity: 1.0, depth: 1.0 },
  calibration: { x: 0, y: 0 },
  mode: 'simple',
  images: {},
};

/** How far (as a scale factor) to overscan the background image so panning
 * it never reveals empty edges. Grows with the configured max displacement. */
export function overscanScaleFor(maxDisplacement: number): number {
  const clamped = Math.min(50, Math.max(0, maxDisplacement));
  return 1 + (clamped / 50) * 0.14; // up to ~1.14x at the highest displacement setting
}
