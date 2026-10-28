import { describe, expect, expectTypeOf, it } from "vitest";

import {
  defineConnectApp,
  type ConnectAppConfig,
  type ConnectToolAsk,
} from "@withone/connect/config";

describe("defineConnectApp", () => {
  it("returns the config it was given, untouched", () => {
    const config = {
      name: "Mastra",
      redirectUris: ["http://localhost:3000/api/one/callback"],
      ask: {
        gmail: {
          access: "custom",
          actions: ["sendEmail", "conn_mod_def::GGSNOTZxFUU::abc"],
        },
        "google-calendar": { access: "read-only" },
        linear: { access: "read-write" },
      },
    } as const;

    expect(defineConnectApp(config)).toBe(config);
  });

  it("keeps the literal types, so the CLI and the editor see exact values", () => {
    const app = defineConnectApp({
      name: "Mastra",
      redirectUris: ["https://app.mastra.ai/api/one/callback"],
      branding: {
        panelColor: "#A02235",
        buttonColor: "#6A2557",
        cobrandEmail: true,
      },
      ask: { linear: { access: "full-access" } },
    });

    expectTypeOf(app.ask.linear.access).toEqualTypeOf<"full-access">();
    expectTypeOf(app.branding.panelColor).toEqualTypeOf<"#A02235">();
  });

  it("types an ask as a level or a non-empty list of actions", () => {
    expectTypeOf<{ access: "read-only" }>().toMatchTypeOf<ConnectToolAsk>();
    expectTypeOf<{
      access: "custom";
      actions: ["sendEmail"];
    }>().toMatchTypeOf<ConnectToolAsk>();
    expectTypeOf<{
      access: "custom";
      actions: [];
    }>().not.toMatchTypeOf<ConnectToolAsk>();
    expectTypeOf<{
      access: "write-only";
    }>().not.toMatchTypeOf<ConnectToolAsk>();
  });

  it("needs a name and at least one redirect URI", () => {
    expectTypeOf<{
      name: string;
      redirectUris: [];
    }>().not.toMatchTypeOf<ConnectAppConfig>();
    expectTypeOf<{
      redirectUris: ["https://a.test/cb"];
    }>().not.toMatchTypeOf<ConnectAppConfig>();
  });
});
