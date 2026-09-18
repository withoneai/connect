/**
 * Public types for @withone/connect.
 *
 * The browser half knows nothing about OAuth: it sends the tab to the
 * app's own authorize route and reports how the flow ended when the tab
 * comes back. The server half (`@withone/connect/server`) owns state,
 * PKCE, the code exchange, refresh and every call made with the grant.
 */

/** Theme of One's hosted connect page. */
export type OneConnectTheme = "light" | "dark";

export interface OneConnectOptions {
  /** The app's own backend authorize route. Relative paths such as
   *  "/api/one/authorize" resolve against the page's origin. */
  authorizeUrl: string;
  /** Theme for One's hosted page. Carried on the URL fragment, which
   *  survives the redirect chain, so the backend forwards nothing. */
  appTheme?: OneConnectTheme;
  /** The grant completed and the backend stored the tokens. */
  onSuccess?: () => void;
  /** The flow ended without a grant: the user declined, the attempt
   *  expired, or the exchange failed. `message` is safe to show. */
  onError?: (message: string) => void;
}

export interface OneConnectHandle {
  /** Navigates the tab to One's hosted connect flow. */
  open: () => void;
}

/** How the app's callback route reports the outcome on its final
 *  redirect, read off the page URL when the tab returns. */
export interface OneConnectReturn {
  status: "success" | "error";
  message?: string;
}

/**
 * A connector chip on the button. Pass One's connector slug ("stripe",
 * "google-calendar") and the SDK shows the logo and the name; pass an
 * object to override either.
 */
export type ConnectButtonPlatformInput =
  | string
  | { slug?: string; name?: string; imageUrl?: string };

/** A normalized chip: what the button actually draws. */
export interface ConnectButtonPlatform {
  slug: string;
  name: string;
  imageUrl: string;
}

export type ConnectButtonVariant = "default" | "accent" | "block";
export type ConnectButtonState = "idle" | "connecting" | "connected";

export interface ConnectButtonOptions {
  /** Everything the flow needs; the button wires open() and the
   *  Connecting and Connected states around your callbacks. */
  connect: OneConnectOptions;
  /** "Connect your apps" unless overridden. */
  label?: string;
  /** default = neutral pill; accent = brand-colored pill; block =
   *  full-width card with a description and a "Secured by One" foot. */
  variant?: ConnectButtonVariant;
  /** Matches the host page, not One's page (that is connect.appTheme). */
  theme?: OneConnectTheme;
  /** Connector chips. The first three render; the rest fold into the
   *  "+N" chip together with moreCount. */
  platforms?: ConnectButtonPlatformInput[];
  /** Extra count for the "+N" chip, e.g. 274 for "the whole catalog". */
  moreCount?: number;
  /** Sub-line on the block variant, shown while idle. */
  description?: string;
  /** Fill of the accent variant; One's lime when omitted. */
  accentColor?: string;
  /** Label for the connected state. */
  connectedLabel?: string;
}

export interface ConnectButtonHandle {
  /** Override the visual state by hand. */
  setState: (state: ConnectButtonState) => void;
  /** Remove the button. */
  destroy: () => void;
}
