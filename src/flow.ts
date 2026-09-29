import { THEME_PARAM } from "./constants";
import { hasReturnParams, parseReturn, stripReturnParams } from "./return";
import type {
  OneConnectFlow,
  OneConnectFlowOptions,
  OneConnectReturn,
} from "./types";

/**
 * The browser half of the flow, shared by every button and hook on the
 * page. The flow is a full-page redirect: the tab goes to the app's
 * authorize route, on to One's hosted page, back to the app's callback
 * route, and home with `?one_connect=…`.
 *
 * That return is a fact about the page load, not about one button, so it
 * is read once here. Every button renders it; the callbacks go to the
 * first flow still mounted when they fire, which is what makes React's
 * StrictMode (mount, unmount, mount) and a second button on the page
 * behave.
 */

interface Subscriber {
  deliver: (outcome: OneConnectReturn) => void;
  restored: () => void;
}

/** undefined until read; null when this load is not a return. */
let pageReturn: OneConnectReturn | null | undefined;
let delivered = false;
let deliveryScheduled = false;
let pageshowBound = false;
const subscribers: Subscriber[] = [];

/** How this page load ended a flow, if it did: `{ status: "success" }`,
 *  `{ status: "error", code, message }`, or null. Read once per load, so
 *  every caller sees the same answer after the address bar is cleaned. */
export function readConnectReturn(): OneConnectReturn | null {
  return readPageReturn();
}

function readPageReturn(): OneConnectReturn | null {
  if (typeof window === "undefined") return null;
  if (pageReturn === undefined) {
    pageReturn = parseReturn(window.location.search);
    if (pageReturn || hasReturnParams(window.location.search))
      scrubAddressBar();
  }
  return pageReturn;
}

/** Removes the params so a refresh does not replay the outcome.
 *  Frameworks that manage history themselves (the Next.js App Router)
 *  put their own URL back when hydration completes, undoing a single
 *  replaceState, so scrub now and re-check a few beats later. */
function scrubAddressBar(): void {
  const scrub = () => {
    if (!hasReturnParams(window.location.search)) return;
    window.history.replaceState(
      window.history.state,
      "",
      stripReturnParams(window.location),
    );
  };
  scrub();
  for (const delay of [50, 500, 2000]) window.setTimeout(scrub, delay);
}

function scheduleDelivery(): void {
  if (delivered || deliveryScheduled) return;
  const outcome = readPageReturn();
  if (!outcome) return;
  deliveryScheduled = true;
  window.setTimeout(() => {
    deliveryScheduled = false;
    const target = subscribers[0];
    // Nobody mounted yet: the next flow to subscribe receives it.
    if (!target || delivered) return;
    delivered = true;
    target.deliver(outcome);
  }, 0);
}

/** A page restored from the back-forward cache keeps its JavaScript
 *  state, so a flow that was mid-redirect would still say Connecting. */
function bindPageshow(): void {
  if (pageshowBound || typeof window === "undefined") return;
  pageshowBound = true;
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    for (const subscriber of [...subscribers]) subscriber.restored();
  });
}

const authorizeUrlFor = (options: OneConnectFlowOptions): string => {
  const theme = options.connectTheme ?? options.appTheme;
  try {
    const url = new URL(options.authorizeUrl, window.location.origin);
    if (theme) url.hash = `${THEME_PARAM}=${theme}`;
    return url.toString();
  } catch {
    return options.authorizeUrl;
  }
};

/**
 * Wires the connect flow to any element: call it once where your button
 * lives, pass `open` to a click, and `destroy` when the element goes.
 * A plain function, so it works from every framework; React apps can use
 * the `useOneConnect` hook from `@withone/connect/react` instead.
 */
export function createConnectFlow(
  options: OneConnectFlowOptions,
): OneConnectFlow {
  let current = options;
  let connecting = false;

  const subscriber: Subscriber = {
    deliver: (outcome) => {
      try {
        if (outcome.status === "success") current.onSuccess?.();
        else current.onError?.(outcome.message ?? "", outcome.code ?? "failed");
      } catch {
        /* the app's own callback threw; not ours to handle */
      }
    },
    restored: () => {
      if (!connecting) return;
      connecting = false;
      try {
        current.onCancel?.();
      } catch {
        /* the app's own callback threw; not ours to handle */
      }
    },
  };

  if (typeof window !== "undefined") {
    subscribers.push(subscriber);
    bindPageshow();
    scheduleDelivery();
  }

  return {
    open: () => {
      if (typeof window === "undefined") return;
      connecting = true;
      window.location.assign(authorizeUrlFor(current));
    },
    update: (next) => {
      current = next;
    },
    destroy: () => {
      const index = subscribers.indexOf(subscriber);
      if (index >= 0) subscribers.splice(index, 1);
    },
  };
}

/** @deprecated Renamed to `createConnectFlow` (it is not a React hook;
 *  React apps can use `useOneConnect` from `@withone/connect/react`).
 *  Removed in the next minor. */
export const useOneConnect = (options: OneConnectFlowOptions): OneConnectFlow =>
  createConnectFlow(options);

/** Test seam: forget this page load's outcome. */
export function resetPageReturnForTests(): void {
  pageReturn = undefined;
  delivered = false;
  deliveryScheduled = false;
  subscribers.length = 0;
}
