/**
 * Pure, allocation-free filter pipeline turning a raw gyro delta into a
 * displacement-ready value. Intentionally has no React/DOM dependency so it
 * can run every animation frame off refs without ever touching state.
 *
 *   raw -> (minus calibration) -> dead zone -> smoothing (lerp) -> sensitivity -> clamp
 */

export interface FilterSettings {
  sensitivity: number; // 0-100
  maxDisplacement: number; // px, 0-50
  smoothing: number; // 0-100 (higher = more inertia / less jitter)
  deadZone: number; // 0-20, in raw-gyro units
  invertHorizontal: boolean;
  invertVertical: boolean;
}

export interface FilterState {
  // Smoothed value carried between frames (mutate in place - no allocations).
  smoothedX: number;
  smoothedY: number;
}

export function createFilterState(): FilterState {
  return { smoothedX: 0, smoothedY: 0 };
}

function applyDeadZone(value: number, deadZone: number): number {
  if (Math.abs(value) <= deadZone) return 0;
  const sign = value > 0 ? 1 : -1;
  return sign * (Math.abs(value) - deadZone);
}

function clamp(value: number, limit: number): number {
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return value;
}

/**
 * Advances the filter by one sample and returns the displacement, in
 * pixels, that the *deepest* (depth = 1.0) layer should move. Multiply by a
 * layer's own strength coefficient (0..1) to get that layer's own offset.
 */
export function stepFilter(
  state: FilterState,
  rawX: number,
  rawY: number,
  calibrationX: number,
  calibrationY: number,
  settings: FilterSettings
): { x: number; y: number } {
  const dzX = applyDeadZone(rawX - calibrationX, settings.deadZone);
  const dzY = applyDeadZone(rawY - calibrationY, settings.deadZone);

  // Smoothing is expressed 0-100 in the UI; convert to a per-frame lerp
  // factor. Higher "smoothing" = slower to respond = closer to 0 alpha.
  const alpha = 1 - Math.min(0.98, Math.max(0.02, settings.smoothing / 100));

  state.smoothedX += (dzX - state.smoothedX) * alpha;
  state.smoothedY += (dzY - state.smoothedY) * alpha;

  const sensitivityMul = settings.sensitivity / 200; // input is tilt in 0.1-degree units
  let x = state.smoothedX * sensitivityMul;
  let y = state.smoothedY * sensitivityMul;

  if (settings.invertHorizontal) x = -x;
  if (settings.invertVertical) y = -y;

  x = clamp(x, settings.maxDisplacement);
  y = clamp(y, settings.maxDisplacement);

  return { x, y };
}
