/** Hand-maintained declarations for the "@withone/connect/react" subpath. */
import type { CSSProperties, ReactElement } from "react";
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
  className?: string;
  style?: CSSProperties;
}

export declare function ConnectButton(props: ConnectButtonProps): ReactElement;
