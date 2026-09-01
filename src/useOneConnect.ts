import {
  EXIT_MESSAGE_TYPE,
  MESSAGE_TYPE,
  RETURN_MESSAGE_PARAM,
  RETURN_STATUS_PARAM,
  THEME_PARAM,
} from "./constants";
import {
  createEmbedIframe,
  getEmbedIframe,
  removeEmbedIframe,
  removeSuccessOverlay,
  showErrorOverlay,
  showSuccessOverlay,
} from "./window";
import type {
  OneConnectHandle,
  OneConnectMessage,
  OneConnectProps,
} from "./types";

// Like useOneAuth, this is a plain function rather than a React hook so
// it works from any framework.

/** The return leg is a page LOAD (redirect mode) — only the first hook
 *  instance on the page consumes it. */
let returnConsumed = false;

export const useOneConnect = (props: OneConnectProps): OneConnectHandle => {
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let resultDelivered = false;
  const mode = props.mode ?? "redirect";

  // The theme rides in the URL FRAGMENT: fragments never reach any
  // server and browsers carry them through the whole redirect chain
  // (consumer's authorize route -> One -> the card), so the consumer's
  // backend forwards NOTHING. Embedding needs no signal at all -- the
  // card detects its own iframe with window.self !== window.top.
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

  const teardown = () => {
    if (typeof window !== "undefined" && messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    removeEmbedIframe();
  };

  const deliver = (status: "success" | "error", message?: string) => {
    if (resultDelivered) return;
    resultDelivered = true;
    teardown();
    // The confirmation beat: by now the frame is gone, so the SDK
    // paints the result card itself — success AND error both live in
    // the widget surface (same as authkit), never only in the host UI.
    if (status === "success") showSuccessOverlay(props.appTheme);
    else showErrorOverlay(props.appTheme, message);
    try {
      if (status === "success") {
        props.onSuccess?.();
      } else {
        props.onError?.(message ?? "The connection was not completed.");
      }
    } catch {
      /* consumer callback errors are not our problem */
    }
  };

  // Only trust messages from OUR iframe's browsing context. Exit can
  // come from One's page (cross-origin); results come from the
  // completion page, which is the consumer's own origin because the
  // OAuth redirect brought the frame home.
  const handleMessage = (event: MessageEvent) => {
    const data = event.data as OneConnectMessage | undefined;
    if (!data) return;

    const iframe = getEmbedIframe();
    if (!iframe || event.source !== iframe.contentWindow) return;

    if (data.type === EXIT_MESSAGE_TYPE) {
      teardown();
      try {
        props.onClose?.();
      } catch {
        /* ignore */
      }
      return;
    }
    if (
      data.type === MESSAGE_TYPE &&
      event.origin === window.location.origin &&
      (data.status === "success" || data.status === "error")
    ) {
      deliver(data.status, data.message);
    }
  };

  // Fires on every navigation inside the frame. While the frame is on
  // One's origin, reading its location throws (same-origin policy) and
  // we ignore it. The moment the consumer's callback redirects home —
  // to ANY same-origin URL carrying ?one_connect=success|error — the
  // read succeeds and the flow completes. The consumer writes no
  // completion page and no postMessage; their callback's final
  // redirect IS the completion signal.
  const handleFrameLoad = () => {
    const iframe = getEmbedIframe();
    if (!iframe) return;
    let href: string;
    try {
      href = iframe.contentWindow?.location.href ?? "";
    } catch {
      return; // still cross-origin — not home yet
    }
    let params: URLSearchParams;
    try {
      params = new URL(href).searchParams;
    } catch {
      return;
    }
    const status = params.get(RETURN_STATUS_PARAM);
    if (status !== "success" && status !== "error") return;
    iframe.style.visibility = "hidden"; // no flash of the landing page
    deliver(status, params.get(RETURN_MESSAGE_PARAM) ?? undefined);
  };

  const open = () => {
    if (typeof window === "undefined") return;
    if (mode === "redirect") {
      // Full-page hosted flow, Stripe-Checkout style: same tab, One's
      // own domain (first-party — works in every browser). The app's
      // callback redirect brings the user home; detection below picks
      // it up on the next load.
      window.location.assign(buildUrl());
      return;
    }
    resultDelivered = false;

    messageHandler = handleMessage;
    window.addEventListener("message", messageHandler);
    const iframe = createEmbedIframe(buildUrl());
    iframe.addEventListener("load", handleFrameLoad);
  };

  const close = (options?: { keepResult?: boolean }) => {
    // A shown result card must be able to OUTLIVE the trigger: hosts
    // naturally unmount the button the moment onSuccess flips their
    // state, and that unmount must not eat the confirmation. The
    // overlay dismisses only via its own controls (X / Close / Esc /
    // scrim) unless the host explicitly closes everything.
    if (!options?.keepResult) removeSuccessOverlay();
    teardown();
  };

  // Redirect-mode return detection: the app's callback redirected the
  // TAB to a URL carrying ?one_connect=… — deliver it once, scrub the
  // params so a refresh doesn't re-fire, and paint the result card.
  if (typeof window !== "undefined" && !returnConsumed) {
    const search = new URLSearchParams(window.location.search);
    const returnStatus = search.get(RETURN_STATUS_PARAM);
    if (returnStatus === "success" || returnStatus === "error") {
      returnConsumed = true;
      const returnMessage = search.get(RETURN_MESSAGE_PARAM) ?? undefined;
      search.delete(RETURN_STATUS_PARAM);
      search.delete(RETURN_MESSAGE_PARAM);
      const clean =
        window.location.pathname +
        (search.toString() ? `?${search.toString()}` : "") +
        window.location.hash;
      window.history.replaceState(null, "", clean);
      // No overlay here: in redirect mode One's HOSTED page already
      // showed the result beat ("You're all set" + countdown / the
      // failure screen) before sending the user home — painting a
      // second card would double-announce. Callbacks still fire so the
      // app updates its own state.
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
