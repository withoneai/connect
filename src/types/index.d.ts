/**
 * Public types for @withone/connect.
 *
 * The SDK deliberately knows nothing about OAuth internals: state, PKCE
 * and the client secret live on the consumer's backend (see README).
 * The SDK only sends the tab to One's hosted connect page and reports
 * how the flow ended when the user comes back.
 */

/** How a completed flow reports back on the return URL. */
export interface OneConnectResult {
  status: "success" | "error";
  /** Human-readable detail for the error case. */
  message?: string;
}

export interface OneConnectProps {
  /**
   * The consumer's OWN backend route that starts the flow. It must
   * generate `state` + PKCE, set them in an httpOnly cookie, and 302
   * to One's /oauth/authorize (full recipe in the README). Relative
   * paths resolve against the host page's origin.
   */
  authorize: {
    url: string;
  };
  /** Theme for One's hosted page. Carried on the URL fragment
   *  (#one_theme=…), which survives the redirect chain — the consumer's
   *  backend forwards nothing. */
  appTheme?: "dark" | "light";
  /** Fired on return when the callback redirect carried
   *  ?one_connect=success. The token exchange already happened on the
   *  consumer's backend by this point. */
  onSuccess?: () => void;
  /** Fired on return when the callback redirect carried an error. */
  onError?: (error: string) => void;
  /** Reserved for future use — the hosted flow's cancel path returns
   *  through onError with the OAuth error string. */
  onClose?: () => void;
}

export interface OneConnectHandle {
  /** Navigates the tab to One's hosted connect flow. */
  open: () => void;
  /** No-op in the full-page flow — kept so hosts can call it
   *  unconditionally (e.g. on unmount). */
  close: (options?: { keepResult?: boolean }) => void;
}

/** A provider chip on the pre-built button. The SDK ships no One URLs,
 *  so icon sources are the consumer's to provide. */
export interface ConnectButtonPlatform {
  name: string;
  imageUrl?: string;
}

export interface ConnectButtonOptions {
  /** Everything useOneConnect takes — the button wires open() and the
   *  Connecting/Connected states around your callbacks. */
  connect: OneConnectProps;
  /** "Connect your apps" unless overridden. */
  label?: string;
  /** default = neutral pill; accent = brand-colored pill; block =
   *  full-width consent card with description + "Secured by One" foot. */
  variant?: "default" | "accent" | "block";
  /** Matches the host page, not One's page (that's connect.appTheme). */
  theme?: "light" | "dark";
  /** Provider chips fanned on hover; first four render, the rest fold
   *  into the +N chip together with moreCount. */
  platforms?: ConnectButtonPlatform[];
  /** Extra count for the +N chip (e.g. 274 for "the whole catalog"). */
  moreCount?: number;
  /** Sub-line on the block variant, shown while idle. */
  description?: string;
  /** accent variant fill; lime (#CCFF00) when omitted. */
  accentColor?: string;
  /** Label for the connected state ("4 apps connected"). */
  connectedLabel?: string;
}

export interface ConnectButtonHandle {
  /** Manually override the visual state. */
  setState: (state: "idle" | "connecting" | "connected") => void;
  /** Remove the button and tear down the flow wiring. */
  destroy: () => void;
}

/** Registers the <one-connect-button> custom element (no-op on servers
 *  and when already registered). Importing the package does this
 *  automatically in browsers; calling it manually is only needed if a
 *  bundler stripped module side effects. */
export declare function registerConnectButton(): void;
