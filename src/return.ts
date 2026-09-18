import { RETURN_MESSAGE_PARAM, RETURN_STATUS_PARAM } from "./constants";
import type { OneConnectReturn } from "./types";

/** Reads the outcome the callback route put on the return URL. */
export function parseReturn(search: string): OneConnectReturn | null {
  const params = new URLSearchParams(search);
  const status = params.get(RETURN_STATUS_PARAM);
  if (status !== "success" && status !== "error") return null;
  const message = params.get(RETURN_MESSAGE_PARAM) ?? undefined;
  return message ? { status, message } : { status };
}

/** The same URL without the return params, so a refresh does not
 *  re-fire the callbacks. */
export function stripReturnParams(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const params = new URLSearchParams(location.search);
  params.delete(RETURN_STATUS_PARAM);
  params.delete(RETURN_MESSAGE_PARAM);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

export function hasReturnParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has(RETURN_STATUS_PARAM) || params.has(RETURN_MESSAGE_PARAM);
}
