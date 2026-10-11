import { EventSourceType, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import type { CaptureState } from '../audio/capture';
export function tapIntent(state: CaptureState, busy: boolean) {
  if (busy) return 'cancel';
  if (state === 'idle') return 'listen';
  if (state === 'starting' || state === 'listening') return 'finish';
  return 'none';
}
export type GestureAction =
  | 'listen'
  | 'release'
  | 'passive'
  | 'dashboard'
  | 'system-exit'
  | 'tap'
  | 'none';
type InputEnvelope = {
  sysEvent?: { eventType?: OsEventTypeList; eventSource?: EventSourceType };
  textEvent?: { eventType?: OsEventTypeList; containerID?: number; eventSource?: EventSourceType };
  listEvent?: { eventType?: OsEventTypeList; containerID?: number; eventSource?: EventSourceType };
};
/** Hosts can deliver input on the system or capture-container stream. An empty
 * system envelope must not hide an accompanying text/list input. */
export function gestureInput(event: InputEnvelope) {
  const inputTypes = [
    OsEventTypeList.CLICK_EVENT,
    OsEventTypeList.DOUBLE_CLICK_EVENT,
    OsEventTypeList.LONG_PRESS_EVENT,
    OsEventTypeList.LONG_PRESS_RELEASE_EVENT,
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
  ];
  const sys = event.sysEvent;
  if (
    sys &&
    (inputTypes.includes(sys.eventType as OsEventTypeList) ||
      (sys.eventType === undefined && sys.eventSource !== undefined))
  )
    return { type: sys.eventType, source: sys.eventSource };
  for (const input of [event.textEvent, event.listEvent]) {
    if (
      input &&
      (input.containerID === undefined || input.containerID === 1) &&
      (input.eventType === undefined || inputTypes.includes(input.eventType))
    )
      return { type: input.eventType, source: input.eventSource };
  }
  return undefined;
}
// Untagged taps support recording, but never pretend to identify a particular temple.
export function gestureAction(
  type: OsEventTypeList | undefined,
  source: EventSourceType | undefined,
  profile: string,
): GestureAction {
  const left = source === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L;
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT)
    return profile === 'store' ? 'system-exit' : left ? 'dashboard' : 'passive';
  if (type === OsEventTypeList.LONG_PRESS_EVENT) return 'listen';
  if (type === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return 'release';
  if (type === OsEventTypeList.CLICK_EVENT || type === undefined) return 'tap';
  return 'none';
}
