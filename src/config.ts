/**
 * A Connect app described as code, for `one connect create`.
 *
 *   // one.connect.ts
 *   import { defineConnectApp } from "@withone/connect/config";
 *
 *   export default defineConnectApp({
 *     name: "Mastra",
 *     redirectUris: ["http://localhost:3000/api/one/callback"],
 *     ask: {
 *       gmail: { access: "custom", actions: ["sendEmail"] },
 *       "google-calendar": { access: "read-only" },
 *       linear: { access: "read-write" },
 *     },
 *   });
 *
 * Types and one identity helper; nothing here calls One. The CLI reads the
 * file and creates or updates the app with your API key, writing the client
 * secret to `.env`. Secrets are never part of the file; the connect key is
 * made in the dashboard, which the CLI opens.
 */

/**
 * Filled in by `one connect types`, which writes a declaration file naming
 * every tool and, for the tools your `ask` names, every action:
 *
 *   declare module "@withone/connect/config" {
 *     interface ConnectRegistry {
 *       tools: "gmail" | "google-calendar" | "linear" | …;
 *       actions: { gmail: "sendEmail" | "listAndViewEmailThreads" | … };
 *     }
 *   }
 *
 * Until it runs, any tool slug and any action name type-check.
 */
export interface ConnectRegistry {}

/** A tool's slug, as One's catalog names it: "gmail", "google-calendar". */
export type ConnectToolSlug = ConnectRegistry extends {
  tools: infer T extends string;
}
  ? T
  : string;

/** An action named for the config: its title in camel case ("sendEmail"),
 *  from the names `one connect types` wrote for that tool. */
export type ConnectActionName<T extends string> = ConnectRegistry extends {
  actions: infer A;
}
  ? T extends keyof A
    ? A[T] & string
    : string
  : string;

/** An action as `actions` takes it: by name, or by its id from One's
 *  catalog (`one actions search` prints it). */
export type ConnectActionRef<T extends string> =
  ConnectActionName<T> | `conn_mod_def::${string}`;

/**
 * How much of a tool the app asks for, in the dashboard's words.
 * - `read-only`: reads only.
 * - `read-write`: reads, creates and updates; never deletes.
 * - `full-access`: everything the tool offers.
 */
export type ConnectAccess = "read-only" | "read-write" | "full-access";

/** One tool's ask: a level, or a hand-picked list of actions. */
export type ConnectToolAsk<T extends string = string> =
  | { access: ConnectAccess }
  | {
      access: "custom";
      actions: readonly [ConnectActionRef<T>, ...ConnectActionRef<T>[]];
    };

/** A colour as `#RRGGBB`. */
export type ConnectHexColor = `#${string}`;

/** How the connect card and its sign-in email look. Omit it to keep
 *  One's own look. */
export interface ConnectAppBranding {
  /** The card's side panel. */
  panelColor: ConnectHexColor;
  /** Authorize, Continue and the other primary buttons. */
  buttonColor: ConnectHexColor;
  /** Whether the sign-in email carries the app's name, logo and colours.
   *  `false` when omitted. */
  cobrandEmail?: boolean;
}

export interface ConnectAppConfig {
  /** Shown on the connect card and in the user's list of apps. */
  name: string;
  /** Every callback URL the app's routes run on, character for character:
   *  local first is fine, then production. */
  redirectUris: readonly [string, ...string[]];
  description?: string;
  /** A public https URL to a square image. */
  logoUrl?: string;
  homepageUrl?: string;
  /** One sentence on the card telling users why the app asks, at most
   *  200 characters. */
  reason?: string;
  branding?: ConnectAppBranding;
  /** The tools the app asks for, keyed by slug. Omit it to let users
   *  choose from everything they have connected. */
  ask?: { [T in ConnectToolSlug]?: ConnectToolAsk<T> };
}

/**
 * Returns `config` unchanged. It exists for the editor: the argument is
 * checked against {@link ConnectAppConfig}, and after `one connect types`
 * tool slugs and action names autocomplete.
 */
export function defineConnectApp<const C extends ConnectAppConfig>(
  config: C,
): C {
  return config;
}
