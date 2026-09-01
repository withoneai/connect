/**
 * React wrapper — `import { ConnectButton } from "@withone/connect/react"`.
 *
 * A real component over the framework-agnostic core, so React apps get
 * idiomatic props (arrays, functions) instead of the custom element's
 * string attributes. React is a peer dependency of THIS subpath only;
 * the core package stays dependency-free for every other framework.
 */
import { createElement, useEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";

import { mountConnectButton } from "./button";
import type {
  ConnectButtonHandle,
  ConnectButtonPlatform,
  ConnectButtonOptions,
} from "./types";

export interface ConnectButtonProps {
  /** The app's own backend authorize route ("/api/one/authorize" is
   *  fine — relative resolves against the page). */
  authorizeUrl: string;
  /** Theme for One's hosted page (rides the URL fragment). */
  appTheme?: "light" | "dark";
  onSuccess?: () => void;
  onError?: (error: string) => void;
  onClose?: () => void;
  label?: string;
  variant?: "default" | "accent" | "block";
  /** Matches the host page, not One's card. */
  theme?: "light" | "dark";
  platforms?: ConnectButtonPlatform[];
  moreCount?: number;
  description?: string;
  accentColor?: string;
  connectedLabel?: string;
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
    onClose: props.onClose,
  });
  callbacksRef.current = {
    onSuccess: props.onSuccess,
    onError: props.onError,
    onClose: props.onClose,
  };

  const platformsKey = JSON.stringify(props.platforms ?? []);

  useEffect(() => {
    if (!containerRef.current) return;
    const options: ConnectButtonOptions = {
      connect: {
        authorize: { url: props.authorizeUrl },
        appTheme: props.appTheme,
        onSuccess: () => callbacksRef.current.onSuccess?.(),
        onError: (error) => callbacksRef.current.onError?.(error),
        onClose: () => callbacksRef.current.onClose?.(),
      },
      label: props.label,
      variant: props.variant,
      theme: props.theme,
      platforms: props.platforms,
      moreCount: props.moreCount,
      description: props.description,
      accentColor: props.accentColor,
      connectedLabel: props.connectedLabel,
    };
    handleRef.current = mountConnectButton(containerRef.current, options);
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // Remount only when the visual/config inputs actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.authorizeUrl,
    props.appTheme,
    props.label,
    props.variant,
    props.theme,
    platformsKey,
    props.moreCount,
    props.description,
    props.accentColor,
    props.connectedLabel,
  ]);

  return createElement("div", {
    ref: containerRef,
    className: props.className,
    style: props.style,
  });
}
