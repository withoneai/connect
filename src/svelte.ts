/**
 * Svelte: `import { connectButton } from "@withone/connect/svelte"`.
 *
 * A Svelte action, the idiomatic shape for DOM-mounting libraries, so no
 * Svelte compiler or dependency is involved:
 *
 *   <div use:connectButton={{ authorizeUrl: "/api/one/authorize",
 *     logos: ["stripe", "notion"], connected: data.hasOneGrant,
 *     onSuccess: () => { ... } }} />
 */
import {
  mountConnectButton,
  type ConnectButtonHandle,
  type ConnectButtonProps,
} from "@withone/connect";

export type { ConnectButtonProps };

export function connectButton(
  node: HTMLElement,
  props: ConnectButtonProps,
): {
  update: (next: ConnectButtonProps) => void;
  destroy: () => void;
} {
  const handle: ConnectButtonHandle = mountConnectButton(node, props);
  return {
    // In place: the button keeps its state and focus across updates.
    update: (next) => handle.update(next),
    destroy: () => handle.destroy(),
  };
}
