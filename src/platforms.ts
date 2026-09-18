import { CONNECTOR_ASSETS_URL } from "./constants";
import type {
  ConnectButtonPlatform,
  ConnectButtonPlatformInput,
} from "./types";

/** "Google Calendar" -> "google-calendar". */
export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "google-calendar" -> "Google Calendar". */
export function nameFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** One's logo for a connector slug. */
export function logoUrlForSlug(slug: string): string {
  return slug ? `${CONNECTOR_ASSETS_URL}/${slug}.svg` : "";
}

/**
 * Turns whatever the developer passed into what the button draws. A bare
 * string is a slug; an object may carry any of slug, name and imageUrl.
 * Entries with neither a slug nor a name are dropped rather than drawn
 * as an empty chip.
 */
export function normalizePlatform(
  input: ConnectButtonPlatformInput,
): ConnectButtonPlatform | null {
  const raw = typeof input === "string" ? { slug: input } : input;
  const slug = raw.slug?.trim()
    ? slugFromName(raw.slug)
    : raw.name?.trim()
      ? slugFromName(raw.name)
      : "";
  if (!slug) return null;
  return {
    slug,
    name: raw.name?.trim() || nameFromSlug(slug),
    imageUrl: raw.imageUrl?.trim() || logoUrlForSlug(slug),
  };
}

export function normalizePlatforms(
  inputs: ConnectButtonPlatformInput[] | undefined,
): ConnectButtonPlatform[] {
  return (inputs ?? [])
    .map(normalizePlatform)
    .filter((p): p is ConnectButtonPlatform => p !== null);
}

/**
 * The `platforms` attribute on <one-connect-button>: a comma list of
 * slugs ("stripe, notion") or, for overrides, a JSON array of
 * {slug, name, imageUrl} objects.
 */
export function parsePlatformsAttribute(
  raw: string | null,
): ConnectButtonPlatformInput[] {
  const value = raw?.trim();
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter(
            (entry): entry is ConnectButtonPlatformInput =>
              typeof entry === "string" ||
              (typeof entry === "object" && entry !== null),
          )
        : [];
    } catch {
      return [];
    }
  }
  return value
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}
