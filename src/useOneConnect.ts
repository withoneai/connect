import {
  RETURN_MESSAGE_PARAM,
  RETURN_STATUS_PARAM,
  THEME_PARAM,
} from "./constants";
import type { OneConnectHandle, OneConnectProps } from "./types";

// Like useOneAuth, this is a plain function rather than a React hook so
// it works from any framework.

/** The return leg is a page LOAD — only the first hook instance on the
 *  page consumes it. */
let returnConsumed = false;

export const useOneConnect = (props: OneConnectProps): OneConnectHandle => {
  let resultDelivered = false;

  // The theme rides in the URL FRAGMENT: fragments never reach any
  // server and browsers carry them through the whole redirect chain
  // (consumer's authorize route -> One -> the hosted page), so the
  // consumer's backend forwards NOTHING.
  const buildUrl = (): string => {
    try {
      // Relative paths ("/api/one/authorize") resolve against the host
      // page — the natural thing to write on a <one-connect-button>.
      const url = new URL(
        props.authorize.url,
        typeof window === "undefined" ? undefined : window.location.origin,
      );
      if (props.appTheme) url.hash = `${THEME_PARAM}=${props.appTheme}`;
      return url.toString();
    } catch {
      return props.authorize.url;
    }
  };

  // Full-page hosted flow, Stripe-Checkout style: same tab, One's own
  // domain (first-party cookies — works in every browser). The app's
  // callback redirect brings the user home; detection below picks it
  // up on the next load.
  const open = () => {
    if (typeof window === "undefined") return;
    window.location.assign(buildUrl());
  };

  // Nothing to dismantle in the full-page flow — kept so hosts (and the
  // button's destroy path) can call it unconditionally.
  const close = (_options?: { keepResult?: boolean }) => {};

  // Return detection: the app's callback redirected the TAB to a URL
  // carrying ?one_connect=… — deliver it once and scrub the params so a
  // refresh doesn't re-fire.
  if (typeof window !== "undefined" && !returnConsumed) {
    const search = new URLSearchParams(window.location.search);
    const returnStatus = search.get(RETURN_STATUS_PARAM);
    if (returnStatus === "success" || returnStatus === "error") {
      returnConsumed = true;
      const returnMessage = search.get(RETURN_MESSAGE_PARAM) ?? undefined;
      // Scrub-and-verify: this code runs during the app's first render,
      // and frameworks that manage the history themselves (Next.js App
      // Router) sync the address bar back to THEIR canonical URL when
      // hydration completes — silently undoing a one-shot replaceState.
      // So scrub now, then re-check a few beats later and scrub again if
      // the params were restored.
      const scrub = () => {
        const params = new URLSearchParams(window.location.search);
        if (
          !params.has(RETURN_STATUS_PARAM) &&
          !params.has(RETURN_MESSAGE_PARAM)
        )
          return;
        params.delete(RETURN_STATUS_PARAM);
        params.delete(RETURN_MESSAGE_PARAM);
        window.history.replaceState(
          null,
          "",
          window.location.pathname +
            (params.toString() ? `?${params.toString()}` : "") +
            window.location.hash,
        );
      };
      scrub();
      for (const delay of [50, 500, 2000]) window.setTimeout(scrub, delay);
      // No overlay: One's HOSTED page already showed the result beat
      // ("You're all set" + countdown / the failure screen) before
      // sending the user home — painting a second card would
      // double-announce. Callbacks fire so the app updates its state.
      window.setTimeout(() => {
        if (resultDelivered) return;
        resultDelivered = true;
        try {
          if (returnStatus === "success") props.onSuccess?.();
          else
            props.onError?.(
              returnMessage ?? "The connection was not completed.",
            );
        } catch {
          /* consumer callback errors are not our problem */
        }
      }, 0);
    }
  }

  return { open, close };
};
