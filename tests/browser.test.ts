import { describe, expect, it } from "vitest";

import {
  normalizePlatform,
  normalizePlatforms,
  parsePlatformsAttribute,
} from "@withone/connect";
import { hasReturnParams, parseReturn, stripReturnParams } from "../src/return";

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
      normalizePlatform({ slug: "stripe", name: "Stripe Billing", imageUrl: "/s.svg" }),
    ).toEqual({ slug: "stripe", name: "Stripe Billing", imageUrl: "/s.svg" });
  });

  it("drops entries that name nothing", () => {
    expect(normalizePlatforms(["", { imageUrl: "/x.svg" }, "notion"])).toHaveLength(1);
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

  it("reads an error with its message", () => {
    expect(parseReturn("?one_connect=error&one_connect_message=You%20cancelled")).toEqual({
      status: "error",
      message: "You cancelled",
    });
  });

  it("ignores unrelated or malformed values", () => {
    expect(parseReturn("?one_connect=maybe")).toBeNull();
    expect(parseReturn("?tab=users")).toBeNull();
  });

  it("strips only its own params", () => {
    expect(
      stripReturnParams({
        pathname: "/dashboard",
        search: "?tab=users&one_connect=success&one_connect_message=x",
        hash: "#top",
      }),
    ).toBe("/dashboard?tab=users#top");
    expect(hasReturnParams("?one_connect=success")).toBe(true);
    expect(hasReturnParams("?tab=users")).toBe(false);
  });
});
