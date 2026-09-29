import {
  LEGACY_MESSAGE_PARAM,
  RETURN_ERROR_PARAM,
  RETURN_STATUS_PARAM,
} from "./constants";
import type { ConnectFailureCode, OneConnectReturn } from "./types";

/** The only text the SDK ever shows for a failed flow. */
export const ERROR_MESSAGES: Record<ConnectFailureCode, string> = {
  declined: "You cancelled the connection.",
  expired: "The connection attempt expired. Please try again.",
  failed: "The connection could not be completed. Please try again.",
};

const isErrorCode = (value: string | null): value is ConnectFailureCode =>
  value !== null && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);

/** Reads the outcome the callback route put on the return URL. The
 *  message always comes from ERROR_MESSAGES, never from the URL. */
export function parseReturn(search: string): OneConnectReturn | null {
  const params = new URLSearchParams(search);
  const status = params.get(RETURN_STATUS_PARAM);
  if (status === "success") return { status };
  if (status !== "error") return null;
  const raw = params.get(RETURN_ERROR_PARAM);
  const code: ConnectFailureCode = isErrorCode(raw) ? raw : "failed";
  return { status, code, message: ERROR_MESSAGES[code] };
}

const OWN_PARAMS = [
  RETURN_STATUS_PARAM,
  RETURN_ERROR_PARAM,
  LEGACY_MESSAGE_PARAM,
];

/** The same URL without the return params, so a refresh does not
 *  re-fire the callbacks. */
export function stripReturnParams(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const params = new URLSearchParams(location.search);
  for (const name of OWN_PARAMS) params.delete(name);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

export function hasReturnParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return OWN_PARAMS.some((name) => params.has(name));
}
