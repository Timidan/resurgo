import { useEffect, useSyncExternalStore } from "react";

/**
 * Staging across the page: while a story is playing its primary beat, secondary actions
 * (the tile spotlight, status dots, idle cursors) hold still. Stories register here.
 */
let playing = 0;
const subs = new Set<() => void>();

function emit() {
  document.documentElement.dataset.beat = playing > 0 ? "on" : "off";
  subs.forEach((f) => f());
}

/** Mark this component as playing a primary beat while `live` is true. */
export function useBeatOwner(live: boolean) {
  useEffect(() => {
    if (!live) return;
    playing++;
    emit();
    return () => {
      playing--;
      emit();
    };
  }, [live]);
}

export function useBeatPlaying(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => playing > 0,
    () => false,
  );
}

/** The lifted-r wordmark in the header listens for this: a run just verified. */
export const LIFT_EVENT = "resurgo:lift";
export const lift = () => window.dispatchEvent(new Event(LIFT_EVENT));
