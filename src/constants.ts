/** Query params the consumer's callback route puts on its final
 *  redirect (any same-origin URL). The SDK reads them off the page URL
 *  when the tab comes home — no completion page required. */
export const RETURN_STATUS_PARAM = "one_connect";
export const RETURN_MESSAGE_PARAM = "one_connect_message";

/** Fragment key on the authorize URL carrying the app-chosen theme.
 *  A fragment never reaches any server and survives the whole redirect
 *  chain, so the consumer's backend forwards nothing. */
export const THEME_PARAM = "one_theme";
