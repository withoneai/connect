// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as browser from "@withone/connect";
import { createConnectFlow, readConnectReturn } from "@withone/connect";

import { resetPageReturnForTests } from "../src/flow";
import { ERROR_MESSAGES } from "../src/return";

/** Lets the flow's setTimeout(0) delivery run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let assign: ReturnType<typeof vi.spyOn>;

const landOn = (search: string) => {
  resetPageReturnForTests();
  history.replaceState(null, "", `/app${search}`);
};

beforeEach(() => {
  landOn("");
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("your own button, any framework: createConnectFlow", () => {
  it("open() sends the tab to the authorize route, resolved against the page", () => {
    createConnectFlow({ authorizeUrl: "/api/one/authorize" }).open();
    expect(assign).toHaveBeenCalledWith(`${location.origin}/api/one/authorize`);
  });

  it("carries the hosted page's theme on the fragment, so the backend forwards nothing", () => {
    createConnectFlow({ authorizeUrl: "/api/one/authorize", connectTheme: "dark" }).open();
    expect(assign).toHaveBeenCalledWith(`${location.origin}/api/one/authorize#one_theme=dark`);
  });

  it("calls onSuccess once when the tab comes home connected, and cleans the address bar", async () => {
    landOn("?one_connect=success&tab=apps");
    const onSuccess = vi.fn();
    createConnectFlow({ authorizeUrl: "/a", onSuccess });
    await tick();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(location.search).toBe("?tab=apps");
  });

  it("calls onError with the fixed message for the code, never text from the URL", async () => {
    landOn("?one_connect=error&one_connect_error=declined&one_connect_message=pwned");
    const onError = vi.fn();
    createConnectFlow({ authorizeUrl: "/a", onError });
    await tick();
    expect(onError).toHaveBeenCalledWith(ERROR_MESSAGES.declined, "declined");
  });

  it("reports nothing after destroy()", async () => {
    landOn("?one_connect=success");
    const onSuccess = vi.fn();
    createConnectFlow({ authorizeUrl: "/a", onSuccess }).destroy();
    await tick();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("uses the callbacks given to update()", async () => {
    landOn("?one_connect=success");
    const first = vi.fn();
    const second = vi.fn();
    createConnectFlow({ authorizeUrl: "/a", onSuccess: first }).update({ authorizeUrl: "/a", onSuccess: second });
    await tick();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reports a Back-button return from One's page as a cancel", () => {
    const onCancel = vi.fn();
    createConnectFlow({ authorizeUrl: "/a", onCancel }).open();
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("readConnectReturn", () => {
  it("answers the same for every caller on one page load", () => {
    landOn("?one_connect=error&one_connect_error=expired");
    const first = readConnectReturn();
    expect(first).toEqual({ status: "error", code: "expired", message: ERROR_MESSAGES.expired });
    expect(readConnectReturn()).toEqual(first);
  });

  it("is null on an ordinary page load", () => {
    expect(readConnectReturn()).toBeNull();
  });
});

describe("the browser entry point", () => {
  it("exports no useOneConnect, so the name only means the React hook", () => {
    expect("useOneConnect" in browser).toBe(false);
  });
});
