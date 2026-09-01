/** Hand-maintained declarations for the "@withone/connect/svelte" subpath. */
import type { ConnectButtonPlatform } from "./types";

export interface ConnectButtonProps {
  authorizeUrl: string;
  appTheme?: "light" | "dark";
  mode?: "redirect" | "modal";
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

/** Svelte action: <div use:connectButton={props} /> */
export declare function connectButton(
  node: HTMLElement,
  props: ConnectButtonProps,
): {
  update: (next: ConnectButtonProps) => void;
  destroy: () => void;
};
