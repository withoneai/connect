import type {
  ConnectButtonOptions,
  ConnectButtonPlatformInput,
  ConnectButtonVariant,
  OneConnectTheme,
} from "./types";

/** The flat prop shape every framework wrapper exposes: React props,
 *  Vue props, the Svelte action's options. One place turns it into the
 *  core mountConnectButton options. */
export interface ConnectButtonProps {
  /** The app's own backend authorize route; relative is fine. */
  authorizeUrl: string;
  /** Theme of One's hosted page. */
  appTheme?: OneConnectTheme;
  onSuccess?: () => void;
  onError?: (message: string) => void;
  label?: string;
  variant?: ConnectButtonVariant;
  /** Matches the host page. */
  theme?: OneConnectTheme;
  /** Connector slugs, or objects to override name or logo. */
  platforms?: ConnectButtonPlatformInput[];
  moreCount?: number;
  description?: string;
  accentColor?: string;
  connectedLabel?: string;
}

export interface ConnectButtonCallbacks {
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export function optionsFromProps(
  props: ConnectButtonProps,
  callbacks: ConnectButtonCallbacks = props,
): ConnectButtonOptions {
  return {
    connect: {
      authorizeUrl: props.authorizeUrl,
      appTheme: props.appTheme,
      onSuccess: () => callbacks.onSuccess?.(),
      onError: (message) => callbacks.onError?.(message),
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

/** The inputs whose change should remount the button. */
export function propsIdentity(props: ConnectButtonProps): string {
  return JSON.stringify([
    props.authorizeUrl,
    props.appTheme,
    props.label,
    props.variant,
    props.theme,
    props.platforms ?? [],
    props.moreCount,
    props.description,
    props.accentColor,
    props.connectedLabel,
  ]);
}
