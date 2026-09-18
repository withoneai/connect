/**
 * Svelte: `import { connectButton } from "@withone/connect/svelte"`.
 *
 * A Svelte action, the idiomatic shape for DOM-mounting libraries, so no
 * Svelte compiler or dependency is involved:
 *
 *   <div use:connectButton={{ authorizeUrl: "/api/one/authorize",
 *     platforms: ["stripe", "notion"],
 *     onSuccess: () => { ... } }} />
 */
import {
  mountConnectButton,
  optionsFromProps,
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
  let handle: ConnectButtonHandle = mountConnectButton(
    node,
    optionsFromProps(props),
  );
  return {
    update(next: ConnectButtonProps) {
      handle.destroy();
      handle = mountConnectButton(node, optionsFromProps(next));
    },
    destroy() {
      handle.destroy();
    },
  };
}
