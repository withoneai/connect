/** Query params the app's callback route puts on its final redirect.
 *  The SDK reads them off the page URL when the tab comes home, so
 *  there is no completion page to build. */
export const RETURN_STATUS_PARAM = "one_connect";
export const RETURN_MESSAGE_PARAM = "one_connect_message";

/** Fragment key on the authorize URL carrying the app-chosen theme.
 *  A fragment never reaches any server and survives the whole redirect
 *  chain, so the app's backend forwards nothing. */
export const THEME_PARAM = "one_theme";

/** One's connector logos, by slug. */
export const CONNECTOR_ASSETS_URL = "https://assets.withone.ai/connectors";

/** One's production API. Point `oneApiUrl` elsewhere for development. */
export const DEFAULT_ONE_API_URL = "https://api.withone.ai";
