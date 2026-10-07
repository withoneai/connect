/**
 * React: `import { ConnectButton, useOneConnect } from "@withone/connect/react"`.
 *
 * Ships with a "use client" directive, so it imports straight into a
 * Next.js Server Component tree. React is a peer dependency of this
 * subpath only.
 */
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import {
  createConnectFlow,
  readConnectReturn,
  renderConnectButton,
  type ConnectButtonHandle,
  type ConnectButtonProps as ConnectButtonCoreProps,
  type ConnectFailureCode,
  type OneConnectFlow,
  type OneConnectFlowOptions,
} from "@withone/connect";

export interface ConnectButtonProps extends ConnectButtonCoreProps {
  /** On the host element, `<span class="one-connect">`. */
  className?: string;
  style?: CSSProperties;
}

/** The props that change what the button draws; callbacks are read
 *  through a ref, so a new function each render costs nothing. */
const visualKey = (props: ConnectButtonCoreProps): string =>
  JSON.stringify([
    props.authorizeUrl,
    props.logos ?? props.platforms ?? [],
    props.connected,
    props.disabled,
    props.variant,
    props.size,
    props.fullWidth,
    props.theme,
    props.connectTheme,
    props.connector,
    props.returnTo,
    props.label,
    props.connectedLabel,
    props.description,
  ]);

export function ConnectButton(props: ConnectButtonProps): ReactElement {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const handleRef = useRef<ConnectButtonHandle | null>(null);
  const keyRef = useRef<string>("");
  const latest = useRef(props);
  latest.current = props;

  const withLatestCallbacks = (): ConnectButtonCoreProps => ({
    ...latest.current,
    onSuccess: () => latest.current.onSuccess?.(),
    onError: (message, code) => latest.current.onError?.(message, code),
    onCancel: () => latest.current.onCancel?.(),
  });

  useEffect(() => {
    if (!hostRef.current) return;
    handleRef.current = renderConnectButton(
      hostRef.current,
      withLatestCallbacks(),
    );
    keyRef.current = visualKey(latest.current);
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // Mounted once; later changes go through update() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const key = visualKey(props);
  useEffect(() => {
    if (!handleRef.current || key === keyRef.current) return;
    keyRef.current = key;
    handleRef.current.update(withLatestCallbacks());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The host is rendered here, layout attributes included, so the server
  // HTML and the hydrated element agree; the button lives in its shadow
  // root, which React never sees.
  return createElement("span", {
    ref: hostRef,
    className: props.className
      ? `one-connect ${props.className}`
      : "one-connect",
    style: props.style,
    "data-variant": props.variant ?? "default",
    "data-full-width": props.fullWidth ? "" : undefined,
  });
}

export type OneConnectStatus = "idle" | "connecting" | "connected" | "error";

export interface UseOneConnectResult {
  /** Sends the tab to One's hosted connect flow. */
  open: () => void;
  /** "connected" and "error" reflect how this page load ended a flow. */
  status: OneConnectStatus;
  error: { message: string; code: ConnectFailureCode } | null;
}

/**
 * The flow for your own button:
 *
 *   const { open, status, error } = useOneConnect({ authorizeUrl: "/api/one/authorize" });
 *   <button onClick={open} disabled={status === "connecting"}>Connect</button>
 */
export function useOneConnect(
  options: OneConnectFlowOptions,
): UseOneConnectResult {
  const [status, setStatus] = useState<OneConnectStatus>("idle");
  const [error, setError] = useState<UseOneConnectResult["error"]>(null);
  const latest = useRef(options);
  latest.current = options;
  const flowRef = useRef<OneConnectFlow | null>(null);

  const withHandlers = (): OneConnectFlowOptions => ({
    ...latest.current,
    onSuccess: () => latest.current.onSuccess?.(),
    onError: (message, code) => latest.current.onError?.(message, code),
    onCancel: () => {
      setStatus("idle");
      latest.current.onCancel?.();
    },
  });

  useEffect(() => {
    const flow = createConnectFlow(withHandlers());
    flowRef.current = flow;
    // Read after mount, not during render, so server and client agree.
    const outcome = readConnectReturn();
    if (outcome?.status === "success") setStatus("connected");
    else if (outcome?.status === "error") {
      setStatus("error");
      setError({
        message: outcome.message ?? "",
        code: outcome.code ?? "failed",
      });
    }
    return () => {
      flow.destroy();
      flowRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    flowRef.current?.update(withHandlers());
  });

  const open = useCallback(() => {
    if (!flowRef.current) return;
    setError(null);
    setStatus("connecting");
    flowRef.current.open();
  }, []);

  return { open, status, error };
}
