/**
 * React: `import { ConnectButton } from "@withone/connect/react"`.
 *
 * A component over the framework-agnostic core, so React apps get real
 * props (arrays, functions) instead of the custom element's string
 * attributes. React is a peer dependency of this subpath only.
 */
import { createElement, useEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";

import {
  mountConnectButton,
  optionsFromProps,
  propsIdentity,
  type ConnectButtonHandle,
  type ConnectButtonProps as ConnectButtonCoreProps,
} from "@withone/connect";

export interface ConnectButtonProps extends ConnectButtonCoreProps {
  className?: string;
  style?: CSSProperties;
}

export function ConnectButton(props: ConnectButtonProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ConnectButtonHandle | null>(null);

  // Callbacks stay fresh without remounting the button.
  const callbacksRef = useRef({
    onSuccess: props.onSuccess,
    onError: props.onError,
  });
  callbacksRef.current = { onSuccess: props.onSuccess, onError: props.onError };

  const identity = propsIdentity(props);

  useEffect(() => {
    if (!containerRef.current) return;
    handleRef.current = mountConnectButton(
      containerRef.current,
      optionsFromProps(props, {
        onSuccess: () => callbacksRef.current.onSuccess?.(),
        onError: (message) => callbacksRef.current.onError?.(message),
      }),
    );
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // Remount only when a visual or config input changes; `identity`
    // captures exactly those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  return createElement("div", {
    ref: containerRef,
    className: props.className,
    style: props.style,
  });
}
