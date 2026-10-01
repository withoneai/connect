export { createConnectFlow, readConnectReturn, useOneConnect } from "./flow";
export {
  mountConnectButton,
  registerConnectButton,
  renderConnectButton,
} from "./button";
export type {
  ConnectButtonHandle,
  ConnectButtonLogo,
  ConnectButtonLogoInput,
  ConnectButtonPlatform,
  ConnectButtonPlatformInput,
  ConnectButtonProps,
  ConnectButtonSize,
  ConnectButtonState,
  ConnectButtonTheme,
  ConnectButtonVariant,
  ConnectFailureCode,
  OneConnectFlow,
  OneConnectFlowOptions,
  OneConnectReturn,
  OneConnectTheme,
} from "./types";

import type { OneConnectFlow, OneConnectFlowOptions } from "./types";
/** @deprecated Renamed to `OneConnectFlowOptions`; removed in the next minor. */
export type OneConnectOptions = OneConnectFlowOptions;
/** @deprecated Renamed to `OneConnectFlow`; removed in the next minor. */
export type OneConnectHandle = OneConnectFlow;
