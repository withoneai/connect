import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOneConnect,
  fillPath,
  formEncode,
  type OneConnectUserStore,
} from "@withone/connect/server";

/* The CLI's way of working, in the SDK: search → knowledge → run. */

const CONNECT_USER_ID = `cu_${"a1".repeat(32)}`;
const CONNECT_KEY = "sk_live_connect_key";
const app = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.example.com/api/one/callback",
  oneApiUrl: "https://api.example.test/",
};

function memoryUsers(): OneConnectUserStore & { users: Map<string, string> } {
  const users = new Map<string, string>();
  return {
    users,
    saveUser: async (userId, reference) => {
      users.set(userId, reference);
    },
    loadUser: async (userId) => users.get(userId) ?? null,
    clearUser: async (userId) => {
      users.delete(userId);
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const INVOICE = {
  _id: "act_invoice",
  title: "Create Invoice",
  method: "post",
  path: "/v1/invoices",
  tags: ["stripe"],
  knowledge: "# Create Invoice\n\nSend `application/x-www-form-urlencoded`…",
  connectionPlatform: "stripe",
};
const THREADS = {
  _id: "act_threads",
  title: "Get Threads",
  method: "POST",
  path: "/v1/gmail/get-threads",
  tags: ["custom"],
  knowledge: "# Get Threads\n\nRequired: `connectionKey`.",
  connectionPlatform: "gmail",
};
const EVENT = {
  _id: "act_event",
  title: "Get Event",
  method: "GET",
  path: "/calendars/{{calendarId}}/events/{{eventId}}",
  tags: [],
  knowledge: "# Get Event",
  connectionPlatform: "google-calendar",
};

describe("fillPath and formEncode", () => {
  it("fills placeholders and refuses a missing one", () => {
    expect(fillPath("/calendars/{{ calendarId }}/events/{{eventId}}", { calendarId: "primary", eventId: "e 1" })).toBe(
      "/calendars/primary/events/e%201",
    );
    expect(() => fillPath("/calendars/{{calendarId}}", {})).toThrow(/calendarId/);
    expect(fillPath("/plain", undefined)).toBe("/plain");
  });
  it("encodes nested fields the way Stripe reads them", () => {
    expect(decodeURIComponent(formEncode({ customer: "cus_1", metadata: { a: "1" }, expand: ["x"], items: [{ price: "p" }], skip: undefined }))).toBe(
      "customer=cus_1&metadata[a]=1&expand[]=x&items[0][price]=p",
    );
  });
});

describe("search, knowledge, run", () => {
  let users: ReturnType<typeof memoryUsers>;
  const fetchMock = vi.fn<typeof fetch>();
  const client = () => createOneConnect({ ...app, connectKey: CONNECT_KEY, userStore: users });
  const call = (index: number) => {
    const [url, init] = fetchMock.mock.calls[index]!;
    return { url: String(url), init: init ?? {}, headers: new Headers(init?.headers) };
  };

  beforeEach(() => {
    users = memoryUsers();
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("searches a platform's actions with One's search, five by default, ranked for running", async () => {
    fetchMock.mockResolvedValueOnce(json([{ systemId: "act_invoice", title: "Create Invoice", method: "post", path: "/v1/invoices", tags: ["stripe"], knowledge: "…" }]));
    const found = await client().searchActions("u1", "stripe", "create an invoice");
    expect(found).toEqual([{ _id: "act_invoice", title: "Create Invoice", method: "POST", path: "/v1/invoices", tags: ["stripe"] }]);
    const { url, headers } = call(0);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/v1/available-actions/search/stripe");
    expect(parsed.searchParams.get("query")).toBe("create an invoice");
    expect(parsed.searchParams.get("limit")).toBe("5");
    expect(parsed.searchParams.get("executeAgent")).toBe("true");
    expect(headers.get("x-one-secret")).toBe(CONNECT_KEY);
    expect(headers.get("x-one-connect-user-id")).toBe(CONNECT_USER_ID);
  });

  it("can search for writing code instead, with its own limit", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [] }));
    await client().searchActions("u1", "gmail", "threads", { limit: 10, mode: "knowledge" });
    const parsed = new URL(call(0).url);
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("knowledgeAgent")).toBe("true");
    expect(parsed.searchParams.has("executeAgent")).toBe(false);
  });

  it("reads an action's knowledge once and keeps it", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [INVOICE] }));
    const oneConnect = client();
    const guide = await oneConnect.getActionKnowledge("u1", "act_invoice");
    expect(guide).toMatchObject({ _id: "act_invoice", method: "POST", path: "/v1/invoices", tags: ["stripe"], platform: "stripe" });
    expect(guide.knowledge).toContain("form-urlencoded");
    expect(new URL(call(0).url).pathname + new URL(call(0).url).search).toBe("/v1/knowledge?_id=act_invoice");

    await oneConnect.getActionKnowledge("u1", "act_invoice");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says when an action id is unknown, and does not keep that answer", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [] }));
    const oneConnect = client();
    await expect(oneConnect.getActionKnowledge("u1", "act_nope")).rejects.toMatchObject({ code: "request_failed", status: 404 });
    fetchMock.mockResolvedValueOnce(json({ rows: [EVENT] }));
    await expect(oneConnect.getActionKnowledge("u1", "act_nope")).resolves.toMatchObject({ _id: "act_event" });
  });

  it("runs an action from its id alone: method and path from the knowledge, placeholders filled", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [EVENT] })).mockResolvedValueOnce(json({ id: "e1" }));
    const reply = await client().runAction("u1", {
      connectionKey: "k1",
      actionId: "act_event",
      pathParams: { calendarId: "primary", eventId: "e1" },
      query: { fields: ["id", "summary"], alt: "json" },
    });
    expect(reply).toEqual({ status: 200, ok: true, blockedByGrant: false, data: { id: "e1" } });
    const { url, init, headers } = call(1);
    expect(url).toBe("https://api.example.test/v1/passthrough/calendars/primary/events/e1?fields=id&fields=summary&alt=json");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(headers.get("x-one-connection-key")).toBe("k1");
    expect(headers.get("x-one-action-id")).toBe("act_event");
  });

  it("gives a custom action the connection key in its body, as the CLI does", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [THREADS] })).mockResolvedValueOnce(json({ threads: [] }));
    await client().runAction("u1", { connectionKey: "k1", actionId: "act_threads", body: { maxResults: 5 } });
    const { init, headers } = call(1);
    expect(init.method).toBe("POST");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ maxResults: 5, connectionKey: "k1" });
  });

  it("encodes a form body and carries the headers an action asks for", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [INVOICE] })).mockResolvedValueOnce(json({ id: "in_1" }));
    await client().runAction("u1", {
      connectionKey: "k1",
      actionId: "act_invoice",
      body: { customer: "cus_1", metadata: { ref: "42" } },
      encoding: "form",
      headers: { "Stripe-Version": "2026-01-01" },
    });
    const { init, headers } = call(1);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(decodeURIComponent(String(init.body))).toBe("customer=cus_1&metadata[ref]=42");
    expect(headers.get("stripe-version")).toBe("2026-01-01");
    // The action headers always win over the caller's.
    expect(headers.get("x-one-action-id")).toBe("act_invoice");
  });

  it("sends a multipart body through FormData", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [{ ...INVOICE, _id: "act_upload", path: "/upload" }] })).mockResolvedValueOnce(json({ ok: true }));
    await client().runAction("u1", { connectionKey: "k1", actionId: "act_upload", body: { purpose: "x", file: new Blob(["hi"]) }, encoding: "multipart" });
    const { init, headers } = call(1);
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("purpose")).toBe("x");
    expect(headers.has("content-type")).toBe(false); // fetch sets the boundary
  });

  it("still takes method and path from the caller, without reading the knowledge", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await client().runAction("u1", { connectionKey: "k1", actionId: "act_x", method: "delete", path: "/things/1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call(0).init.method).toBe("DELETE");
    expect(call(0).url).toBe("https://api.example.test/v1/passthrough/things/1");
  });

  it("refuses to run when a placeholder has no value, before calling One", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [EVENT] }));
    await expect(client().runAction("u1", { connectionKey: "k1", actionId: "act_event" })).rejects.toMatchObject({ code: "request_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
