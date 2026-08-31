import type { ConnectButtonOptions, ConnectButtonPlatform } from "./types";

/** The flat prop shape every framework wrapper exposes (React props,
 *  Vue props, Svelte action options) — one place to translate it into
 *  the core mountConnectButton options. */
export interface ConnectButtonWrapperProps {
  authorizeUrl: string;
  appTheme?: "light" | "dark";
  onSuccess?: () => void;
  onError?: (error: string) => void;
  onClose?: () => void;
  label?: string;
  variant?: "default" | "accent" | "block";
  theme?: "light" | "dark";
  platforms?: ConnectButtonPlatform[];
  moreCount?: number;
  description?: string;
  accentColor?: string;
  connectedLabel?: string;
}

export function optionsFromWrapperProps(
  props: ConnectButtonWrapperProps,
  callbacks?: {
    onSuccess?: () => void;
    onError?: (error: string) => void;
    onClose?: () => void;
  },
): ConnectButtonOptions {
  const cb = callbacks ?? props;
  return {
    connect: {
      authorize: { url: props.authorizeUrl },
      appTheme: props.appTheme,
      onSuccess: () => cb.onSuccess?.(),
      onError: (error) => cb.onError?.(error),
      onClose: () => cb.onClose?.(),
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
}
