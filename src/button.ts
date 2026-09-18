import { normalizePlatforms, parsePlatformsAttribute } from "./platforms";
import { useOneConnect } from "./useOneConnect";
import type {
  ConnectButtonHandle,
  ConnectButtonOptions,
  ConnectButtonState,
  OneConnectHandle,
} from "./types";

/**
 * The pre-built trigger for the connect flow. Optional: `useOneConnect`
 * with any element remains fully supported. Framework-agnostic: it
 * renders real DOM into a container, so React, Vue, Svelte and plain
 * HTML all mount it the same way.
 *
 * The button owns the flow wiring: a click opens the flow, the label
 * turns "Connecting" while the tab is away, and lands on "Connected"
 * when the return carries a success.
 */

const STYLE_ID = "one-connect-button-styles";
const EASE = "cubic-bezier(.2,.9,.25,1)";
const MAX_VISIBLE_CHIPS = 3;

/** One's palette (see the Clockwork design system): lime is the brand
 *  call-to-action, spring is success, carbon is the ink. */
const LIME = "#CCFF00";
const SPRING = "#3FE3A5";
const CARBON = "#0A0C0B";

interface Palette {
  buttonBackground: string;
  buttonForeground: string;
  surface: string;
  foreground: string;
  muted: string;
  line: string;
  shadow: string;
}

const LIGHT: Palette = {
  buttonBackground: CARBON,
  buttonForeground: "#FFFFFF",
  surface: "#FFFFFF",
  foreground: CARBON,
  muted: "#6B7280",
  line: "#D1D5DB",
  shadow: "0 1px 2px rgba(10,12,11,.08), 0 4px 14px rgba(10,12,11,.06)",
};

const DARK: Palette = {
  buttonBackground: "#F2F5F3",
  buttonForeground: CARBON,
  surface: "#101312",
  foreground: "#F2F5F3",
  muted: "#8A938E",
  line: "#2A302D",
  shadow: "0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35)",
};

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
    `.owcb-chip{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;overflow:hidden;margin-left:-7px;transition:margin-left .28s ${EASE};position:relative;background:#FFFFFF}`,
    ".owcb-chip:first-child{margin-left:0}",
    ".owcb-chip img{width:14px;height:14px;display:block;object-fit:contain}",
    `.owcb-chip.owcb-more{font-family:ui-monospace,monospace;font-size:9px;font-weight:500;letter-spacing:-.02em;color:${CARBON}}`,
    `.owcb-chip.owcb-letter{font:600 10px ui-monospace,monospace;color:${CARBON}}`,
    ".owcb:hover .owcb-chip{margin-left:-2px}",
    ".owcb:hover .owcb-chip:first-child{margin-left:0}",
    ".owcb-label{white-space:nowrap}",
    `.owcb-arrow{opacity:.5;transition:transform .2s ${EASE},opacity .2s ${EASE}}`,
    ".owcb:hover .owcb-arrow{transform:translateX(2px);opacity:.8}",
    ".owcb-spinner{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;opacity:.7;animation:owcb-spin .7s linear infinite}",
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
): HTMLElement | null {
  const platforms = normalizePlatforms(options.platforms);
  if (platforms.length === 0 && !options.moreCount) return null;
  const stack = document.createElement("span");
  stack.className = "owcb-stack";
  stack.setAttribute("aria-hidden", "true");
  for (const platform of platforms.slice(0, MAX_VISIBLE_CHIPS)) {
    const chip = document.createElement("span");
    chip.className = "owcb-chip";
    chip.title = platform.name;
    chip.style.boxShadow = `0 0 0 1.5px ${chipRing}`;
    const img = document.createElement("img");
    img.alt = "";
    img.src = platform.imageUrl;
    img.addEventListener("error", () => {
      img.remove();
      chip.classList.add("owcb-letter");
      chip.textContent = platform.name.charAt(0).toUpperCase();
    });
    chip.appendChild(img);
    stack.appendChild(chip);
  }
  const extra =
    (options.moreCount ?? 0) +
    Math.max(0, platforms.length - MAX_VISIBLE_CHIPS);
  if (extra > 0) {
    const more = document.createElement("span");
    more.className = "owcb-chip owcb-more";
    more.style.boxShadow = `0 0 0 1.5px ${chipRing}`;
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
  const connectedLabel = options.connectedLabel ?? "Connected";

  let state: ConnectButtonState = "idle";
  let destroyed = false;

  const flow: OneConnectHandle = useOneConnect({
    ...options.connect,
    onSuccess: () => {
      setState("connected");
      options.connect.onSuccess?.();
    },
    onError: (message) => {
      setState("idle");
      options.connect.onError?.(message);
    },
  });

  const button = document.createElement("button");
  button.type = "button";
  button.className = variant === "block" ? "owcb owcb-block" : "owcb";
  button.addEventListener("click", () => {
    if (state === "connecting") return;
    setState("connecting");
    flow.open();
  });

  const titleFor = (): string =>
    state === "connecting"
      ? "Connecting…"
      : state === "connected"
        ? connectedLabel
        : label;

  const paint = () => {
    const accent = variant === "accent";
    const block = variant === "block";
    const background = block
      ? palette.surface
      : accent
        ? (options.accentColor ?? LIME)
        : palette.buttonBackground;
    const foreground = block
      ? palette.foreground
      : accent
        ? CARBON
        : palette.buttonForeground;
    const chipRing = block ? palette.surface : background;

    button.style.background =
      state === "connected" && !block ? SPRING : background;
    button.style.color = state === "connected" && !block ? CARBON : foreground;
    button.style.boxShadow = block
      ? `inset 0 0 0 1px ${palette.line}`
      : state === "connected"
        ? "none"
        : accent
          ? `0 1px 2px rgba(10,12,11,.1), 0 6px 20px ${options.accentColor ?? LIME}38`
          : palette.shadow;
    button.disabled = state === "connecting";
    button.innerHTML = "";

    const stack = buildStack(options, chipRing);

    if (block) {
      const top = document.createElement("span");
      top.className = "owcb-block-top";
      const title = document.createElement("span");
      title.className = "owcb-block-title";
      title.textContent = titleFor();
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
      const foot = document.createElement("span");
      foot.className = "owcb-block-foot";
      foot.style.color = palette.muted;
      foot.style.borderTop = `1px solid ${palette.line}`;
      foot.innerHTML =
        `<span style="font-size:11px;color:${palette.muted}">Secured by</span>` +
        `<span style="display:inline-flex;color:${palette.foreground}">${ONE_MARK_SVG}</span>` +
        `<span style="font-size:12px;font-weight:600;letter-spacing:-0.02em;color:${palette.foreground}">one</span>`;
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
    text.textContent = titleFor();
    button.appendChild(text);

    if (state === "idle") {
      const arrow = document.createElement("span");
      arrow.innerHTML = ARROW_SVG;
      arrow.style.display = "inline-flex";
      button.appendChild(arrow);
    }
  };

  const setState = (next: ConnectButtonState) => {
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
      button.remove();
    },
  };
};

/**
 * <one-connect-button>: one tag for any framework. The element wires the
 * whole flow from its attributes and manages Connect, Connecting and
 * Connected. Registered automatically in the browser on import; defined
 * inside a function so importing this module on a server never touches
 * HTMLElement.
 *
 * Attributes: authorize-url (required), app-theme, label, variant,
 * theme, platforms ("stripe, notion" or a JSON array), more-count,
 * description, accent-color, connected-label.
 * Events: "success" and "error" (detail: message), plus the matching
 * onSuccess and onError function properties that React 19, Vue and
 * Svelte set naturally as props.
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
    onError: ((message: string) => void) | null = null;

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
      if (!authorizeUrl) return;

      const moreCountRaw = this.getAttribute("more-count");
      const moreCount = moreCountRaw ? parseInt(moreCountRaw, 10) : NaN;

      this.handle = mountConnectButton(this, {
        connect: {
          authorizeUrl,
          appTheme: attributeAs(this, "app-theme", ["light", "dark"]),
          onSuccess: () => {
            this.onSuccess?.();
            this.dispatchEvent(new CustomEvent("success"));
          },
          onError: (message) => {
            this.onError?.(message);
            this.dispatchEvent(new CustomEvent("error", { detail: message }));
          },
        },
        label: this.getAttribute("label") ?? undefined,
        variant: attributeAs(this, "variant", ["default", "accent", "block"]),
        theme: attributeAs(this, "theme", ["light", "dark"]),
        platforms: parsePlatformsAttribute(this.getAttribute("platforms")),
        moreCount: Number.isFinite(moreCount) ? moreCount : undefined,
        description: this.getAttribute("description") ?? undefined,
        accentColor: this.getAttribute("accent-color") ?? undefined,
        connectedLabel: this.getAttribute("connected-label") ?? undefined,
      });
    }
  }

  customElements.define("one-connect-button", OneConnectButtonElement);
}

/** An attribute narrowed to a known set of values; anything else is
 *  treated as unset rather than passed through. */
function attributeAs<T extends string>(
  element: HTMLElement,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = element.getAttribute(name);
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

registerConnectButton();
