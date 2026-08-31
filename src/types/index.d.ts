/**
 * Public types for @withone/connect.
 *
 * The SDK deliberately knows nothing about OAuth internals: state, PKCE
 * and the client secret live on the consumer's backend (see README).
 * The SDK only opens One's connect experience as a modal over the host
 * page and reports how the flow ended.
 */

/** Result posted back from the consumer's completion page. */
export interface OneConnectResult {
  status: "success" | "error";
  /** Human-readable detail for the error case. */
  message?: string;
}

export interface OneConnectProps {
  /**
   * The consumer's OWN backend route that starts the flow. It must
   * generate `state` + PKCE, set them in an httpOnly cookie, and 302
   * to One's /oauth/authorize (full recipe in the README). Must be an
   * absolute URL.
   */
  authorize: {
    url: string;
  };
  /** Theme for One's card. Carried on the URL fragment (#one_theme=…),
   *  which survives the redirect chain — the consumer's backend forwards
   *  nothing. */
  appTheme?: "dark" | "light";
  /** Fired when the completion page reports success. The token exchange
   *  already happened on the consumer's backend by this point. */
  onSuccess?: () => void;
  /** Fired when the completion page reports an error. */
  onError?: (error: string) => void;
  /** Fired when the user closes the card without a result. */
  onClose?: () => void;
}

export interface OneConnectHandle {
  /** Opens One's connect modal over the current page. */
  open: () => void;
  /** Tears everything down: modal frame + listeners. */
  close: () => void;
}

/** Message posted from the completion page up to the host page. */
export interface OneConnectMessage {
  type: string; // MESSAGE_TYPE constant
  status: "success" | "error";
  message?: string;
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
  /** Matches the host page, not One's card (that's connect.appTheme). */
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
