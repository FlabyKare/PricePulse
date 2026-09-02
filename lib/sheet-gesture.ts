export const SHEET_DISMISS_DISTANCE = 96;
export const SHEET_DISMISS_FLICK_DISTANCE = 36;
export const SHEET_DISMISS_VELOCITY = 0.55;

export function shouldDismissSheetDrag(distance: number, elapsedMs: number) {
  const downwardDistance = Math.max(0, distance);
  const velocity = downwardDistance / Math.max(1, elapsedMs);
  return downwardDistance >= SHEET_DISMISS_DISTANCE
    || (downwardDistance >= SHEET_DISMISS_FLICK_DISTANCE && velocity >= SHEET_DISMISS_VELOCITY);
}