import { describe, expect, it } from "vitest";

import {
  nameFromSlug,
  normalizePlatform,
  normalizePlatforms,
  parsePlatformsAttribute,
} from "../src/platforms";
import {
  ERROR_MESSAGES,
  hasReturnParams,
  parseReturn,
  stripReturnParams,
} from "../src/return";

describe("platforms", () => {
  it("turns a slug into a name and a logo", () => {
    expect(normalizePlatform("google-calendar")).toEqual({
      slug: "google-calendar",
      name: "Google Calendar",
      imageUrl: "https://assets.withone.ai/connectors/google-calendar.svg",
    });
  });

  it("accepts a name and derives the slug", () => {
    expect(normalizePlatform({ name: "Google Calendar" })?.slug).toBe(
      "google-calendar",
    );
  });

  it("keeps an explicit logo and name", () => {
    expect(
      normalizePlatform({
        slug: "stripe",
        name: "Stripe Billing",
        imageUrl: "/s.svg",
      }),
    ).toEqual({ slug: "stripe", name: "Stripe Billing", imageUrl: "/s.svg" });
  });

  it("spells brands the way they spell themselves", () => {
    expect(nameFromSlug("hubspot")).toBe("HubSpot");
    expect(nameFromSlug("one-drive")).toBe("OneDrive");
    expect(nameFromSlug("google-calendar")).toBe("Google Calendar");
  });

  it("drops entries that name nothing", () => {
    expect(
      normalizePlatforms(["", { imageUrl: "/x.svg" }, "notion"]),
    ).toHaveLength(1);
  });

  it("parses a comma list attribute", () => {
    expect(parsePlatformsAttribute(" stripe, notion ,gmail ")).toEqual([
      "stripe",
      "notion",
      "gmail",
    ]);
  });

  it("parses a JSON attribute and ignores garbage", () => {
    expect(parsePlatformsAttribute('[{"slug":"stripe"},"notion",4]')).toEqual([
      { slug: "stripe" },
      "notion",
    ]);
    expect(parsePlatformsAttribute("[not json")).toEqual([]);
    expect(parsePlatformsAttribute(null)).toEqual([]);
  });
});

describe("return params", () => {
  it("reads a success", () => {
    expect(parseReturn("?one_connect=success")).toEqual({ status: "success" });
  });

  it("reads an error code and shows only fixed text for it", () => {
    expect(
      parseReturn("?one_connect=error&one_connect_error=declined"),
    ).toEqual({
      status: "error",
      code: "declined",
      message: ERROR_MESSAGES.declined,
    });
  });

  it("never shows text that arrived on the URL", () => {
    // A crafted link: free text in the legacy param, an unknown code.
    const crafted = parseReturn(
      "?one_connect=error&one_connect_error=call-us&one_connect_message=Your%20account%20is%20locked",
    );
    expect(crafted).toEqual({
      status: "error",
      code: "failed",
      message: ERROR_MESSAGES.failed,
    });
    expect(JSON.stringify(crafted)).not.toContain("locked");
  });

  it("ignores unrelated or malformed values", () => {
    expect(parseReturn("?one_connect=maybe")).toBeNull();
    expect(parseReturn("?tab=users")).toBeNull();
  });

  it("strips only its own params", () => {
    expect(
      stripReturnParams({
        pathname: "/dashboard",
        search:
          "?tab=users&one_connect=error&one_connect_error=failed&one_connect_message=x",
        hash: "#top",
      }),
    ).toBe("/dashboard?tab=users#top");
    expect(hasReturnParams("?one_connect=success")).toBe(true);
    expect(hasReturnParams("?tab=users")).toBe(false);
  });
});
