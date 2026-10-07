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

/** Theme of the button: fixed, or following the visitor's setting. */
export type ConnectButtonTheme = "light" | "dark" | "auto";

/**
 * Why a flow ended without a grant. The callback route puts only this
 * code on the return URL; the text shown for it is fixed in the SDK, so
 * a crafted link can never put its own words in front of the user.
 *
 * - `declined`: the user cancelled on One's page.
 * - `expired`: the attempt took too long or was started elsewhere.
 * - `failed`: One could not complete the connection.
 */
export type ConnectFailureCode = "declined" | "expired" | "failed";

export interface OneConnectFlowOptions {
  /** The app's own backend authorize route. Relative paths such as
   *  "/api/one/authorize" resolve against the page's origin. */
  authorizeUrl: string;
  /** Theme for One's hosted page. Carried on the URL fragment, which
   *  survives the redirect chain, so the backend forwards nothing. */
  connectTheme?: OneConnectTheme;
  /** A connector slug ("gmail"). One's page opens that connector's
   *  connect screen first, then shows the full list as usual. Carried
   *  on the URL fragment like the theme. */
  connector?: string;
  /** Where the user lands afterwards, for this flow only: a path on
   *  your app such as "/chat/42". Your authorize route reads it and
   *  the callback uses it instead of the server's `returnTo`. */
  returnTo?: string;
  /** The grant completed and the backend stored the tokens. Fires once
   *  per page load, on the first flow still mounted when the tab
   *  returns. Treat it as a hint to refetch: your server is the truth. */
  onSuccess?: () => void;
  /** The flow ended without a grant. `message` is fixed text for
   *  `code`, safe to show. */
  onError?: (message: string, code: ConnectFailureCode) => void;
  /** The user came back with the browser's Back button before finishing
   *  (the page was restored from the back-forward cache). */
  onCancel?: () => void;
}

export interface OneConnectFlow {
  /** Navigates the tab to One's hosted connect flow. */
  open: () => void;
  /** Swaps the options (callbacks, theme) without losing the flow. */
  update: (options: OneConnectFlowOptions) => void;
  /** Stops listening: callbacks no longer fire for this flow. */
  destroy: () => void;
}

/** How the flow ended, read off the page URL when the tab returns. */
export interface OneConnectReturn {
  status: "success" | "error";
  code?: ConnectFailureCode;
  message?: string;
}

/**
 * A logo chip on the button. Pass One's connector slug ("stripe",
 * "google-calendar") and the SDK shows its logo and name; pass an
 * object to override either. Decoration only: what One asks the user
 * for comes from the app's permission set, not from this list.
 */
export type ConnectButtonLogoInput =
  string | { slug?: string; name?: string; imageUrl?: string };

/** A normalized chip: what the button actually draws. */
export interface ConnectButtonLogo {
  slug: string;
  name: string;
  imageUrl: string;
}

/** @deprecated Renamed to `ConnectButtonLogoInput`; removed in 0.18.0. */
export type ConnectButtonPlatformInput = ConnectButtonLogoInput;
/** @deprecated Renamed to `ConnectButtonLogo`; removed in 0.18.0. */
export type ConnectButtonPlatform = ConnectButtonLogo;

export type ConnectButtonVariant = "default" | "accent" | "block";
export type ConnectButtonSize = "sm" | "md" | "lg";
export type ConnectButtonState = "idle" | "connecting" | "connected";

/** One prop shape for every surface: React, Vue, Svelte, the custom
 *  element and `mountConnectButton`. */
export interface ConnectButtonProps {
  /** The app's own backend authorize route; relative is fine. */
  authorizeUrl: string;
  /** Logos to draw on the button: connector slugs, or objects that
   *  override the name or the image. The first three draw; the rest fold
   *  into a "+N" chip. Decoration only; the permission set decides what
   *  One asks for. */
  logos?: ConnectButtonLogoInput[];
  /** @deprecated Renamed to `logos`; removed in 0.18.0. */
  platforms?: ConnectButtonLogoInput[];
  /** Whether this user has a live grant, from your server. When set, it
   *  decides the Connected state. When omitted, the button shows
   *  Connected only right after a successful return. */
  connected?: boolean;
  /** Not clickable, for example until terms are accepted. */
  disabled?: boolean;
  /** default = neutral, accent = your brand colour (set
   *  `--one-connect-accent` and `--one-connect-accent-fg` on the host),
   *  block = a card with a description and a "Secured by One" foot. */
  variant?: ConnectButtonVariant;
  size?: ConnectButtonSize;
  /** Stretches to the width of its container. */
  fullWidth?: boolean;
  /** Matches the host page. "auto" follows the visitor's setting. */
  theme?: ConnectButtonTheme;
  /** Theme of One's hosted page. */
  connectTheme?: OneConnectTheme;
  /** A connector slug ("gmail") to open first on One's page. */
  connector?: string;
  /** Where this flow returns to: a path on your app. */
  returnTo?: string;
  /** "Connect your apps" unless set. */
  label?: string;
  /** "Connected" unless set. */
  connectedLabel?: string;
  /** Sub-line on the block variant. */
  description?: string;
  onSuccess?: () => void;
  onError?: (message: string, code: ConnectFailureCode) => void;
  onCancel?: () => void;
}

export interface ConnectButtonHandle {
  /** Applies new props in place, keeping the button's state. */
  update: (props: ConnectButtonProps) => void;
  /** Removes the button and stops its callbacks. */
  destroy: () => void;
}
