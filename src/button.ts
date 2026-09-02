import { useOneConnect } from "./useOneConnect";
import type {
  ConnectButtonHandle,
  ConnectButtonOptions,
  OneConnectHandle,
} from "./types";

/**
 * Optional pre-built trigger for the connect flow. Entirely opt-in —
 * `useOneConnect` alone with any element the consumer likes remains
 * fully supported. Framework-agnostic like the rest of the SDK: it
 * renders real DOM into a container, so React/Vue/vanilla all mount it
 * the same way. Zero dependencies, zero One URLs — provider icons are
 * passed in by the consumer.
 *
 * The button owns the flow wiring: click opens the card, the label
 * turns "Connecting…" while the card is up, and lands on a spring
 * "Connected" state on success (Connect → Connecting → Connected; the
 * verb never changes).
 */

const STYLE_ID = "one-connect-button-styles";
const EASE = "cubic-bezier(.2,.9,.25,1)";

interface Palette {
  btnBg: string;
  btnFg: string;
  surface: string;
  fg: string;
  muted: string;
  line: string;
  shadow: string;
}

const LIGHT: Palette = {
  btnBg: "#0A0C0B",
  btnFg: "#ffffff",
  surface: "#ffffff",
  fg: "#0A0C0B",
  muted: "#6B7280",
  line: "#D1D5DB",
  shadow: "0 1px 2px rgba(10,12,11,.08), 0 4px 14px rgba(10,12,11,.06)",
};

const DARK: Palette = {
  btnBg: "#F2F5F3",
  btnFg: "#0A0C0B",
  surface: "#101312",
  fg: "#F2F5F3",
  muted: "#8A938E",
  line: "#2A302D",
  shadow: "0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35)",
};

const LIME = "#CCFF00";
const SPRING = "#3FE3A5";
const CARBON = "#0A0C0B";

/** The One ring mark — same glyph the card footer pairs with the
 *  wordmark. Inline so the SDK stays free of One URLs. */
const ONE_MARK_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" style="flex-shrink:0"><circle cx="12" cy="12" r="8.5"/></svg>';
const ARROW_SVG =
  '<svg class="owcb-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>';
const TICK_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M3 8.5l3.5 3.5L13 5"/></svg>';

function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID))
    return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    `.owcb{font:500 14.5px/1.2 inherit;font-family:inherit;letter-spacing:-.01em;cursor:pointer;border:0;display:inline-flex;align-items:center;gap:12px;padding:12px 16px 12px 14px;border-radius:12px;transition:transform .2s ${EASE},box-shadow .2s ${EASE},opacity .2s ${EASE}}`,
    ".owcb:hover{transform:translateY(-1px)}",
    ".owcb:active{transform:translateY(0)}",
    `.owcb:focus-visible{outline:2px solid ${SPRING};outline-offset:3px}`,
    ".owcb[disabled]{cursor:default;opacity:.75;transform:none}",
    ".owcb-stack{display:inline-flex;align-items:center;flex-shrink:0}",
    `.owcb-chip{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;overflow:hidden;margin-left:-7px;transition:margin-left .28s ${EASE};position:relative}`,
    ".owcb-chip:first-child{margin-left:0}",
    ".owcb-chip img{width:14px;height:14px;display:block;object-fit:contain}",
    ".owcb-chip.owcb-more{font-family:ui-monospace,monospace;font-size:9px;font-weight:500;letter-spacing:-.02em}",
    ".owcb:hover .owcb-chip{margin-left:-2px}",
    ".owcb:hover .owcb-chip:first-child{margin-left:0}",
    ".owcb-label{white-space:nowrap}",
    `.owcb-arrow{opacity:.5;transition:transform .2s ${EASE},opacity .2s ${EASE}}`,
    ".owcb:hover .owcb-arrow{transform:translateX(2px);opacity:.8}",
    `.owcb-spinner{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;opacity:.7;animation:owcb-spin .7s linear infinite}`,
    "@keyframes owcb-spin{to{transform:rotate(360deg)}}",
    ".owcb.owcb-block{display:flex;flex-direction:column;align-items:stretch;width:100%;max-width:420px;text-align:left;padding:16px;border-radius:14px;gap:0}",
    ".owcb-block-top{display:flex;align-items:center;justify-content:space-between;gap:12px}",
    ".owcb-block-title{font-size:15px;font-weight:600;letter-spacing:-.01em}",
    ".owcb-block-sub{font-size:13px;line-height:1.5;margin-top:6px;font-weight:400}",
    ".owcb-block-foot{margin-top:14px;padding-top:12px;display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:400}",
    "@media (prefers-reduced-motion:reduce){.owcb,.owcb-chip,.owcb-arrow{transition:none}.owcb-spinner{animation-duration:1.4s}}",
  ].join("\n");
  document.head.appendChild(style);
}

function buildStack(
  options: ConnectButtonOptions,
  chipRing: string,
  moreColor: string,
): HTMLElement | null {
  // At most this many provider chips render; everything past it folds
  // into a single "+N" chip so the button stays clean and uncrowded.
  const MAX_VISIBLE_CHIPS = 3;
  const platforms = options.platforms ?? [];
  if (platforms.length === 0 && !options.moreCount) return null;
  const stack = document.createElement("span");
  stack.className = "owcb-stack";
  stack.setAttribute("aria-hidden", "true");
  for (const platform of platforms.slice(0, MAX_VISIBLE_CHIPS)) {
    const chip = document.createElement("span");
    chip.className = "owcb-chip";
    chip.style.background = "#ffffff";
    chip.style.boxShadow = `0 0 0 1.5px ${chipRing}`;
    if (platform.imageUrl) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = platform.imageUrl;
      img.addEventListener("error", () => {
        img.style.display = "none";
        chip.textContent = platform.name.charAt(0).toUpperCase();
        chip.style.font = "600 10px ui-monospace,monospace";
        chip.style.color = CARBON;
      });
      chip.appendChild(img);
    } else {
      chip.textContent = platform.name.charAt(0).toUpperCase();
      chip.style.font = "600 10px ui-monospace,monospace";
      chip.style.color = CARBON;
    }
    stack.appendChild(chip);
  }
  const extra =
    (options.moreCount ?? 0) +
    Math.max(0, platforms.length - MAX_VISIBLE_CHIPS);
  if (extra > 0) {
    const more = document.createElement("span");
    more.className = "owcb-chip owcb-more";
    more.style.background = "#ffffff";
    more.style.boxShadow = `0 0 0 1.5px ${chipRing}`;
    more.style.color = moreColor;
    more.textContent = `+${extra}`;
    stack.appendChild(more);
  }
  return stack;
}

export const mountConnectButton = (
  container: HTMLElement,
  options: ConnectButtonOptions,
): ConnectButtonHandle => {
  ensureStyles();

  const palette = options.theme === "dark" ? DARK : LIGHT;
  const variant = options.variant ?? "default";
  const label = options.label ?? "Connect your apps";

  let state: "idle" | "connecting" | "connected" = "idle";
  let destroyed = false;

  const handle: OneConnectHandle = useOneConnect({
    ...options.connect,
    onSuccess: () => {
      setState("connected");
      options.connect.onSuccess?.();
    },
    onError: (error) => {
      setState("idle");
      options.connect.onError?.(error);
    },
    onClose: () => {
      setState("idle");
      options.connect.onClose?.();
    },
  });

  const button = document.createElement("button");
  button.type = "button";
  button.className = variant === "block" ? "owcb owcb-block" : "owcb";
  button.addEventListener("click", () => {
    if (state !== "idle" && state !== "connected") return;
    setState("connecting");
    handle.open();
  });

  const paint = () => {
    const accent = variant === "accent";
    const block = variant === "block";
    const bg = block
      ? palette.surface
      : accent
        ? (options.accentColor ?? LIME)
        : palette.btnBg;
    const fg = block ? palette.fg : accent ? CARBON : palette.btnFg;
    const chipRing = block ? palette.surface : bg;
    // The "+N" chip sits on a WHITE background (like the provider chips),
    // so its text must be dark — never the button's fg, which is white on
    // the default dark button and would vanish. CARBON matches the
    // letter-fallback chips.
    const moreColor = CARBON;

    button.style.background = state === "connected" && !block ? SPRING : bg;
    button.style.color = state === "connected" && !block ? CARBON : fg;
    button.style.boxShadow = block
      ? `inset 0 0 0 1px ${palette.line}`
      : state === "connected"
        ? "none"
        : accent
          ? `0 1px 2px rgba(10,12,11,.1), 0 6px 20px ${(options.accentColor ?? LIME)}38`
          : palette.shadow;
    button.disabled = state === "connecting";
    button.innerHTML = "";

    const stack = buildStack(options, chipRing, moreColor);

    if (block) {
      const top = document.createElement("span");
      top.className = "owcb-block-top";
      const title = document.createElement("span");
      title.className = "owcb-block-title";
      title.textContent =
        state === "connecting"
          ? "Connecting…"
          : state === "connected"
            ? (options.connectedLabel ?? "Connected")
            : label;
      top.appendChild(title);
      if (state === "connecting") {
        const spinner = document.createElement("span");
        spinner.className = "owcb-spinner";
        top.appendChild(spinner);
      } else if (stack) {
        top.appendChild(stack);
      }
      button.appendChild(top);
      if (options.description && state === "idle") {
        const sub = document.createElement("span");
        sub.className = "owcb-block-sub";
        sub.style.color = palette.muted;
        sub.textContent = options.description;
        button.appendChild(sub);
      }
      // Mirrors the card/overlay footer strip: "Secured by" + ring mark
      // + "one" wordmark, so the button and the surface it opens read as
      // the same product.
      const foot = document.createElement("span");
      foot.className = "owcb-block-foot";
      foot.style.color = palette.muted;
      foot.style.borderTop = `1px solid ${palette.line}`;
      foot.innerHTML =
        `<span style="font-size:11px;color:${palette.muted}">Secured by</span>` +
        `<span style="display:inline-flex;color:${palette.fg}">${ONE_MARK_SVG}</span>` +
        `<span style="font-size:12px;font-weight:600;letter-spacing:-0.02em;color:${palette.fg}">one</span>`;
      button.appendChild(foot);
      return;
    }

    if (state === "connecting") {
      const spinner = document.createElement("span");
      spinner.className = "owcb-spinner";
      button.appendChild(spinner);
    } else if (state === "connected") {
      const tick = document.createElement("span");
      tick.innerHTML = TICK_SVG;
      tick.style.display = "inline-flex";
      button.appendChild(tick);
    } else if (stack) {
      button.appendChild(stack);
    }

    const text = document.createElement("span");
    text.className = "owcb-label";
    text.textContent =
      state === "connecting"
        ? "Connecting…"
        : state === "connected"
          ? (options.connectedLabel ?? "Connected")
          : label;
    button.appendChild(text);

    if (state === "idle") {
      const arrow = document.createElement("span");
      arrow.innerHTML = ARROW_SVG;
      arrow.style.display = "inline-flex";
      button.appendChild(arrow);
    }
  };

  const setState = (next: "idle" | "connecting" | "connected") => {
    if (destroyed) return;
    state = next;
    paint();
  };

  paint();
  container.appendChild(button);

  return {
    setState,
    destroy: () => {
      destroyed = true;
      handle.close({ keepResult: true });
      button.remove();
    },
  };
};

/**
 * <one-connect-button> — the simple path. One tag, any framework
 * (React, Vue, Svelte, plain HTML): the element wires the whole flow
 * itself from its attributes and manages Connect → Connecting →
 * Connected. Registered automatically in the browser on import;
 * defined inside a function so importing this module on a server
 * (Next.js SSR) never touches HTMLElement.
 *
 * Attributes: authorize-url (required), app-theme, label, variant,
 * theme, platforms (JSON array of {name, imageUrl}), more-count,
 * description, accent-color, connected-label.
 * Events: "success" | "error" (detail: message) | "close" — plus
 * matching function properties (onSuccess/onError/onClose) that
 * React 19 / Vue / Svelte set naturally as props.
 */
export function registerConnectButton(): void {
  if (typeof window === "undefined" || typeof customElements === "undefined")
    return;
  if (customElements.get("one-connect-button")) return;

  class OneConnectButtonElement extends HTMLElement {
    static observedAttributes = [
      "authorize-url",
      "app-theme",
      "label",
      "variant",
      "theme",
      "platforms",
      "more-count",
      "description",
      "accent-color",
      "connected-label",
    ];

    onSuccess: (() => void) | null = null;
    onError: ((error: string) => void) | null = null;
    onClose: (() => void) | null = null;

    private handle: ConnectButtonHandle | null = null;

    connectedCallback(): void {
      this.mount();
    }

    disconnectedCallback(): void {
      this.handle?.destroy();
      this.handle = null;
    }

    attributeChangedCallback(): void {
      if (this.isConnected && this.handle) this.mount();
    }

    private mount(): void {
      this.handle?.destroy();
      this.handle = null;
      const authorizeUrl = this.getAttribute("authorize-url");
      if (!authorizeUrl) return; // nothing to wire yet

      let platforms: ConnectButtonOptions["platforms"];
      const rawPlatforms = this.getAttribute("platforms");
      if (rawPlatforms) {
        try {
          const parsed = JSON.parse(rawPlatforms) as unknown;
          if (Array.isArray(parsed)) platforms = parsed;
        } catch {
          /* malformed platforms JSON — render without chips */
        }
      }

      const moreCountRaw = this.getAttribute("more-count");
      const moreCount = moreCountRaw ? parseInt(moreCountRaw, 10) : undefined;

      this.handle = mountConnectButton(this, {
        connect: {
          authorize: { url: authorizeUrl },
          appTheme:
            (this.getAttribute("app-theme") as "light" | "dark" | null) ??
            undefined,
          onSuccess: () => {
            this.onSuccess?.();
            this.dispatchEvent(new CustomEvent("success"));
          },
          onError: (error) => {
            this.onError?.(error);
            this.dispatchEvent(new CustomEvent("error", { detail: error }));
          },
          onClose: () => {
            this.onClose?.();
            this.dispatchEvent(new CustomEvent("close"));
          },
        },
        label: this.getAttribute("label") ?? undefined,
        variant:
          (this.getAttribute("variant") as ConnectButtonOptions["variant"]) ??
          undefined,
        theme:
          (this.getAttribute("theme") as "light" | "dark" | null) ?? undefined,
        platforms,
        moreCount: Number.isFinite(moreCount) ? moreCount : undefined,
        description: this.getAttribute("description") ?? undefined,
        accentColor: this.getAttribute("accent-color") ?? undefined,
        connectedLabel: this.getAttribute("connected-label") ?? undefined,
      });
    }
  }

  customElements.define("one-connect-button", OneConnectButtonElement);
}

registerConnectButton();
