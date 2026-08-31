/** Hand-maintained declarations for the "@withone/connect/vue" subpath. */
import type { DefineComponent } from "vue";
import type { ConnectButtonPlatform } from "./types";

export declare const ConnectButton: DefineComponent<{
  authorizeUrl: string;
  appTheme?: "light" | "dark";
  label?: string;
  variant?: "default" | "accent" | "block";
  theme?: "light" | "dark";
  platforms?: ConnectButtonPlatform[];
  moreCount?: number;
  description?: string;
  accentColor?: string;
  connectedLabel?: string;
}>;
