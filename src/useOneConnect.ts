import { THEME_PARAM } from "./constants";
import { hasReturnParams, parseReturn, stripReturnParams } from "./return";
import type { OneConnectHandle, OneConnectOptions } from "./types";

/** The return leg is a page load, so it is delivered exactly once, to
 *  the first instance that reads it. */
let returnConsumed = false;

const DEFAULT_ERROR = "The connection was not completed.";

/**
 * Wires the connect flow to any element. A plain function rather than a
 * React hook, so it works from every framework: call it once where the
 * button lives and pass `open` to a click.
 *
 * The flow is a full-page redirect: the tab goes to the app's authorize
 * route, on to One's hosted page, back to the app's callback route, and
 * home. On the way home the callback route appends `?one_connect=…` to
 * the URL it redirects to; this function reads that on load, fires
 * onSuccess or onError once, and removes the params from the address bar.
 */
export const useOneConnect = (options: OneConnectOptions): OneConnectHandle => {
  const buildAuthorizeUrl = (): string => {
    try {
      const url = new URL(
        options.authorizeUrl,
        typeof window === "undefined" ? undefined : window.location.origin,
      );
      if (options.appTheme) url.hash = `${THEME_PARAM}=${options.appTheme}`;
      return url.toString();
    } catch {
      return options.authorizeUrl;
    }
  };

  const open = () => {
    if (typeof window === "undefined") return;
    window.location.assign(buildAuthorizeUrl());
  };

  if (typeof window !== "undefined" && !returnConsumed) {
    const outcome = parseReturn(window.location.search);
    if (outcome) {
      returnConsumed = true;
      // Frameworks that manage the history themselves (the Next.js App
      // Router) sync the address bar back to their own URL when hydration
      // completes, undoing a single replaceState. Scrub now and re-check a
      // few beats later.
      const scrub = () => {
        if (!hasReturnParams(window.location.search)) return;
        window.history.replaceState(
          null,
          "",
          stripReturnParams(window.location),
        );
      };
      scrub();
      for (const delay of [50, 500, 2000]) window.setTimeout(scrub, delay);

      window.setTimeout(() => {
        try {
          if (outcome.status === "success") options.onSuccess?.();
          else options.onError?.(outcome.message ?? DEFAULT_ERROR);
        } catch {
          /* the app's own callback threw; not ours to handle */
        }
      }, 0);
    }
  }

  return { open };
};
