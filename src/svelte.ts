/**
 * Svelte — `import { connectButton } from "@withone/connect/svelte"`.
 *
 * A Svelte ACTION (the idiomatic Svelte shape for DOM-mounting
 * libraries), so no Svelte compiler or dependency is involved:
 *
 *   <div use:connectButton={{ authorizeUrl: "/api/one/authorize",
 *     platforms: [{ name: "Stripe", imageUrl: "/icons/stripe.svg" }],
 *     onSuccess: () => { ... } }} />
 */
import { mountConnectButton } from "./button";
import {
  optionsFromWrapperProps,
  type ConnectButtonWrapperProps,
} from "./wrapper-options";
import type { ConnectButtonHandle } from "./types";

export type { ConnectButtonWrapperProps as ConnectButtonProps };

export function connectButton(
  node: HTMLElement,
  props: ConnectButtonWrapperProps,
): {
  update: (next: ConnectButtonWrapperProps) => void;
  destroy: () => void;
} {
  let handle: ConnectButtonHandle = mountConnectButton(
    node,
    optionsFromWrapperProps(props),
  );
  return {
    update(next: ConnectButtonWrapperProps) {
      handle.destroy();
      handle = mountConnectButton(node, optionsFromWrapperProps(next));
    },
    destroy() {
      handle.destroy();
    },
  };
}
