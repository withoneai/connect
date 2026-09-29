// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { mountConnectButton } from "@withone/connect";
import { ConnectButton, useOneConnect } from "@withone/connect/react";
import { connectButton } from "@withone/connect/svelte";
import { ConnectButton as VueConnectButton } from "@withone/connect/vue";
import { createApp, h, nextTick, ref } from "vue";

import { readableTextOn } from "../src/button";
import { resetPageReturnForTests } from "../src/flow";
import { ERROR_MESSAGES } from "../src/return";

// Tells React this is a test environment that wraps updates in act().
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Lets the flow's setTimeout(0) delivery run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const buttonIn = (container: Element): HTMLButtonElement => {
  const host = container.querySelector(".one-connect") ?? container;
  const button = host.shadowRoot?.querySelector("button");
  if (!button) throw new Error("no button rendered");
  return button;
};
const labelOf = (container: Element) =>
  buttonIn(container).querySelector('[part="label"]')?.textContent;
const statusOf = (container: Element) =>
  (
    container.querySelector(".one-connect") ?? container
  ).shadowRoot?.querySelector('[role="status"]')?.textContent;

let assign: ReturnType<typeof vi.spyOn>;
let container: HTMLDivElement;

beforeEach(() => {
  resetPageReturnForTests();
  history.replaceState(null, "", "/app");
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

const returnTo = (search: string) => {
  resetPageReturnForTests();
  history.replaceState(null, "", `/app${search}`);
};

describe("the button", () => {
  it("renders in a shadow root with its styles adopted, not inline", () => {
    mountConnectButton(container, {
      authorizeUrl: "/api/one/authorize",
      platforms: ["gmail", "notion"],
    });
    const host = container.querySelector(".one-connect")!;
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot!.adoptedStyleSheets).toHaveLength(1);
    expect(host.shadowRoot!.querySelector("style")).toBeNull();
    // No element carries a style attribute: a strict CSP would drop it.
    expect(host.shadowRoot!.querySelectorAll("[style]")).toHaveLength(0);
    expect(document.head.querySelector("style")).toBeNull();
    const button = buttonIn(container);
    expect(button.getAttribute("part")).toBe("button");
    expect(labelOf(container)).toBe("Connect your apps");
    expect(button.dataset).toMatchObject({
      variant: "default",
      size: "md",
      theme: "light",
      state: "idle",
    });
  });

  it("goes to the authorize route, busy but still focusable", () => {
    mountConnectButton(container, {
      authorizeUrl: "/api/one/authorize",
      connectTheme: "dark",
    });
    const button = buttonIn(container);
    button.focus();
    button.click();
    expect(assign).toHaveBeenCalledWith(
      `${location.origin}/api/one/authorize#one_theme=dark`,
    );
    expect(labelOf(container)).toBe("Connecting…");
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(statusOf(container)).toBe("Connecting to One…");
    button.click();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("returns to idle and reports a cancel when the page comes back from the back-forward cache", () => {
    const onCancel = vi.fn();
    mountConnectButton(container, { authorizeUrl: "/a", onCancel });
    buttonIn(container).click();
    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true }),
    );
    expect(labelOf(container)).toBe("Connect your apps");
    expect(buttonIn(container).getAttribute("aria-busy")).toBe("false");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores a pageshow that is a normal load", () => {
    mountConnectButton(container, { authorizeUrl: "/a" });
    buttonIn(container).click();
    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: false }),
    );
    expect(labelOf(container)).toBe("Connecting…");
  });

  it("does nothing while disabled", () => {
    mountConnectButton(container, { authorizeUrl: "/a", disabled: true });
    const button = buttonIn(container);
    expect(button.disabled).toBe(true);
    button.click();
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows Connected on every button after a successful return, and calls back once", async () => {
    returnTo("?one_connect=success");
    const first = vi.fn();
    const second = vi.fn();
    const other = document.createElement("div");
    document.body.appendChild(other);
    mountConnectButton(container, { authorizeUrl: "/a", onSuccess: first });
    mountConnectButton(other, { authorizeUrl: "/a", onSuccess: second });
    await tick();
    expect(labelOf(container)).toBe("Connected");
    expect(labelOf(other)).toBe("Connected");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(location.search).toBe("");
    other.remove();
  });

  it("hands the callback to the button that survives a StrictMode remount", async () => {
    returnTo("?one_connect=success");
    const thrownAway = vi.fn();
    const kept = vi.fn();
    mountConnectButton(container, {
      authorizeUrl: "/a",
      onSuccess: thrownAway,
    }).destroy();
    mountConnectButton(container, { authorizeUrl: "/a", onSuccess: kept });
    await tick();
    expect(thrownAway).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(labelOf(container)).toBe("Connected");
  });

  it("reports a failure with fixed text and its code", async () => {
    returnTo(
      "?one_connect=error&one_connect_error=expired&one_connect_message=Call%20us",
    );
    const onError = vi.fn();
    mountConnectButton(container, { authorizeUrl: "/a", onError });
    await tick();
    expect(onError).toHaveBeenCalledWith(ERROR_MESSAGES.expired, "expired");
    expect(labelOf(container)).toBe("Connect your apps");
  });

  it("lets the server's connected prop decide, in both directions", async () => {
    const handle = mountConnectButton(container, {
      authorizeUrl: "/a",
      connected: true,
    });
    expect(labelOf(container)).toBe("Connected");
    const button = buttonIn(container);
    handle.update({ authorizeUrl: "/a", connected: false });
    expect(labelOf(container)).toBe("Connect your apps");
    // Updated in place: the same element, so focus is never lost.
    expect(buttonIn(container)).toBe(button);

    returnTo("?one_connect=success");
    const other = document.createElement("div");
    mountConnectButton(other, { authorizeUrl: "/a", connected: false });
    await tick();
    expect(labelOf(other)).toBe("Connect your apps");
  });

  it("picks readable text for the accent colour", () => {
    expect(readableTextOn("#1B2A5C")).toBe("#FFFFFF");
    expect(readableTextOn("#CCFF00")).toBe("#0A0C0B");
    expect(readableTextOn("rgb(255, 255, 255)")).toBe("#0A0C0B");
    mountConnectButton(container, {
      authorizeUrl: "/a",
      variant: "accent",
      accentColor: "#1B2A5C",
    });
    // On the button inside the shadow root, never on the host.
    const button = buttonIn(container);
    expect(button.style.getPropertyValue("--one-connect-accent")).toBe(
      "#1B2A5C",
    );
    expect(button.style.getPropertyValue("--one-connect-accent-fg")).toBe(
      "#FFFFFF",
    );
    const host = container.querySelector<HTMLElement>(".one-connect")!;
    expect(host.hasAttribute("style")).toBe(false);
  });

  it("names the block card by its title and describes it by its sub-line", () => {
    mountConnectButton(container, {
      authorizeUrl: "/a",
      variant: "block",
      description: "Let Acme reach your tools.",
    });
    const button = buttonIn(container);
    const root = button.getRootNode() as ShadowRoot;
    expect(
      root.getElementById(button.getAttribute("aria-labelledby")!)?.textContent,
    ).toBe("Connect your apps");
    expect(
      root.getElementById(button.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Let Acme reach your tools.");
  });

  it("shows three logos and folds the rest into +N", () => {
    mountConnectButton(container, {
      authorizeUrl: "/a",
      platforms: ["gmail", "google-calendar", "notion", "stripe", "hubspot"],
    });
    const chips = buttonIn(container).querySelectorAll(".chip");
    expect(chips).toHaveLength(4);
    expect(chips[3].textContent).toBe("+2");
  });

  it("removes everything on destroy", () => {
    const handle = mountConnectButton(container, { authorizeUrl: "/a" });
    handle.destroy();
    expect(container.querySelector(".one-connect")).toBeNull();
  });
});

describe("<one-connect-button>", () => {
  it("never writes to its own attributes, so a server-rendered page hydrates unchanged", () => {
    container.innerHTML =
      '<one-connect-button authorize-url="/a" variant="accent" accent-color="#1B2A5C" full-width></one-connect-button>';
    const element = container.querySelector("one-connect-button")!;
    expect(element.shadowRoot?.querySelector("button")).toBeTruthy();
    expect(element.getAttributeNames().sort()).toEqual([
      "accent-color",
      "authorize-url",
      "full-width",
      "variant",
    ]);
  });

  it("maps attributes to props and dispatches events with a code", async () => {
    returnTo("?one_connect=error&one_connect_error=declined");
    const element = document.createElement("one-connect-button");
    element.setAttribute("authorize-url", "/api/one/authorize");
    element.setAttribute("size", "lg");
    element.setAttribute("theme", "auto");
    element.toggleAttribute("full-width", true);
    const events: unknown[] = [];
    element.addEventListener("error", (event) =>
      events.push((event as unknown as CustomEvent).detail),
    );
    container.appendChild(element);
    await tick();
    const button = buttonIn(element);
    expect(button.dataset).toMatchObject({ size: "lg", theme: "auto" });
    expect(button.hasAttribute("data-full-width")).toBe(true);
    expect(events).toEqual([
      { message: ERROR_MESSAGES.declined, code: "declined" },
    ]);

    element.setAttribute("connected", "");
    expect(buttonIn(element)).toBe(button);
    expect(labelOf(element)).toBe("Connected");
  });
});

describe("React", () => {
  it("renders its host with the layout attributes, and hydrates without a mismatch", async () => {
    const props = {
      authorizeUrl: "/a",
      variant: "block" as const,
      fullWidth: true,
      className: "mine",
    };
    const html = renderToString(createElement(ConnectButton, props));
    expect(html).toBe(
      '<span class="one-connect mine" data-variant="block" data-full-width=""></span>',
    );
    container.innerHTML = html;
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, createElement(ConnectButton, props), {
        onRecoverableError: recoverable,
      });
    });
    expect(recoverable).not.toHaveBeenCalled();
    const host = container.firstElementChild as HTMLElement;
    expect(host.tagName).toBe("SPAN");
    expect(host.outerHTML).toBe(html);
    expect(host.shadowRoot?.querySelector("button")?.dataset.variant).toBe(
      "block",
    );
    await act(async () => root!.unmount());
  });

  const render = async (node: ReturnType<typeof createElement>) => {
    const root = createRoot(container);
    await act(async () => root.render(node));
    await act(tick);
    return root;
  };

  it("shows Connected under StrictMode and calls back once", async () => {
    returnTo("?one_connect=success");
    const onSuccess = vi.fn();
    const root = await render(
      createElement(
        StrictMode,
        null,
        createElement(ConnectButton, { authorizeUrl: "/a", onSuccess }),
      ),
    );
    expect(labelOf(container)).toBe("Connected");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".one-connect")).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("updates in place when props change, without remounting", async () => {
    const root = await render(
      createElement(ConnectButton, { authorizeUrl: "/a", label: "Connect" }),
    );
    const button = buttonIn(container);
    await act(async () =>
      root.render(
        createElement(ConnectButton, {
          authorizeUrl: "/a",
          label: "Link your tools",
        }),
      ),
    );
    expect(buttonIn(container)).toBe(button);
    expect(labelOf(container)).toBe("Link your tools");
    await act(async () => root.unmount());
  });

  it("useOneConnect reports status and opens the flow", async () => {
    returnTo("?one_connect=error&one_connect_error=failed");
    const seen: ReturnType<typeof useOneConnect>[] = [];
    function Probe() {
      const result = useOneConnect({ authorizeUrl: "/api/one/authorize" });
      seen.push(result);
      return null;
    }
    const root = await render(createElement(Probe));
    expect(seen.at(-1)).toMatchObject({
      status: "error",
      error: { code: "failed", message: ERROR_MESSAGES.failed },
    });
    await act(async () => seen.at(-1)!.open());
    expect(seen.at(-1)?.status).toBe("connecting");
    expect(assign).toHaveBeenCalledWith(`${location.origin}/api/one/authorize`);
    await act(async () => root.unmount());
  });
});

describe("Vue", () => {
  it("passes props, updates in place and emits the code", async () => {
    returnTo("?one_connect=error&one_connect_error=declined");
    const connected = ref<boolean | undefined>(undefined);
    const errors: unknown[] = [];
    const app = createApp({
      render: () =>
        h(VueConnectButton, {
          authorizeUrl: "/a",
          size: "sm",
          connected: connected.value,
          onError: (message: string, code: string) =>
            errors.push([message, code]),
        }),
    });
    app.mount(container);
    await tick();
    const button = buttonIn(container);
    expect(button.dataset.size).toBe("sm");
    // An absent boolean prop stays "not set", so the return decides.
    expect(labelOf(container)).toBe("Connect your apps");
    expect(errors).toEqual([[ERROR_MESSAGES.declined, "declined"]]);
    connected.value = true;
    await nextTick();
    expect(labelOf(container)).toBe("Connected");
    expect(buttonIn(container)).toBe(button);
    app.unmount();
    expect(container.querySelector(".one-connect")).toBeNull();
  });
});

describe("Svelte action", () => {
  it("mounts, updates in place and destroys", () => {
    const action = connectButton(container, { authorizeUrl: "/a" });
    const button = buttonIn(container);
    action.update({ authorizeUrl: "/a", connected: true });
    expect(buttonIn(container)).toBe(button);
    expect(labelOf(container)).toBe("Connected");
    action.destroy();
    expect(container.querySelector(".one-connect")).toBeNull();
  });
});
