/**
 * Vue 3: `import { ConnectButton } from "@withone/connect/vue"`.
 *
 *   <ConnectButton
 *     authorize-url="/api/one/authorize"
 *     :platforms="['stripe', 'notion']"
 *     :connected="user.hasOneGrant"
 *     @success="onConnected"
 *   />
 *
 * Vue is an optional peer dependency of this subpath only.
 */
import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { PropType } from "vue";

import {
  renderConnectButton,
  type ConnectButtonHandle,
  type ConnectButtonPlatformInput,
  type ConnectButtonProps,
  type ConnectButtonSize,
  type ConnectButtonTheme,
  type ConnectButtonVariant,
  type ConnectFailureCode,
  type OneConnectTheme,
} from "@withone/connect";

/** Booleans default to undefined, not false, so "not set" stays
 *  distinguishable from "false" (it matters for `connected`). */
const optionalBoolean = { type: Boolean, default: undefined };

export const ConnectButton = defineComponent({
  name: "OneConnectButton",
  props: {
    authorizeUrl: { type: String, required: true },
    platforms: {
      type: Array as PropType<ConnectButtonPlatformInput[]>,
      default: undefined,
    },
    connected: optionalBoolean,
    disabled: optionalBoolean,
    variant: {
      type: String as PropType<ConnectButtonVariant>,
      default: undefined,
    },
    size: { type: String as PropType<ConnectButtonSize>, default: undefined },
    fullWidth: optionalBoolean,
    theme: { type: String as PropType<ConnectButtonTheme>, default: undefined },
    connectTheme: {
      type: String as PropType<OneConnectTheme>,
      default: undefined,
    },
    /** @deprecated use connectTheme */
    appTheme: { type: String as PropType<OneConnectTheme>, default: undefined },
    accentColor: { type: String, default: undefined },
    label: { type: String, default: undefined },
    connectedLabel: { type: String, default: undefined },
    description: { type: String, default: undefined },
  },
  emits: {
    success: () => true,
    error: (message: string, code: ConnectFailureCode) =>
      typeof message === "string" && typeof code === "string",
    cancel: () => true,
  },
  setup(props, { emit }) {
    const host = ref<HTMLElement | null>(null);
    let handle: ConnectButtonHandle | null = null;

    const current = (): ConnectButtonProps => ({
      ...props,
      onSuccess: () => emit("success"),
      onError: (message, code) => emit("error", message, code),
      onCancel: () => emit("cancel"),
    });

    onMounted(() => {
      if (host.value) handle = renderConnectButton(host.value, current());
    });
    watch(
      () => ({ ...props }),
      () => handle?.update(current()),
      { deep: true },
    );
    onBeforeUnmount(() => {
      handle?.destroy();
      handle = null;
    });

    // The host carries its layout attributes from the render, so server
    // and client HTML agree; the button lives in its shadow root.
    return () =>
      h("span", {
        ref: host,
        class: "one-connect",
        "data-variant": props.variant ?? "default",
        "data-full-width": props.fullWidth ? "" : undefined,
      });
  },
});
