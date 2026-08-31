/**
 * Vue 3 — `import { ConnectButton } from "@withone/connect/vue"`.
 *
 *   <ConnectButton
 *     authorize-url="/api/one/authorize"
 *     :platforms="[{ name: 'Stripe', imageUrl: '/icons/stripe.svg' }]"
 *     @success="onConnected"
 *   />
 *
 * vue is an optional peer dependency of THIS subpath only.
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

import { mountConnectButton } from "./button";
import { optionsFromWrapperProps } from "./wrapper-options";
import type { ConnectButtonHandle, ConnectButtonPlatform } from "./types";

export const ConnectButton = defineComponent({
  name: "OneConnectButton",
  props: {
    authorizeUrl: { type: String, required: true },
    appTheme: { type: String as PropType<"light" | "dark">, default: undefined },
    label: { type: String, default: undefined },
    variant: {
      type: String as PropType<"default" | "accent" | "block">,
      default: undefined,
    },
    theme: { type: String as PropType<"light" | "dark">, default: undefined },
    platforms: {
      type: Array as PropType<ConnectButtonPlatform[]>,
      default: undefined,
    },
    moreCount: { type: Number, default: undefined },
    description: { type: String, default: undefined },
    accentColor: { type: String, default: undefined },
    connectedLabel: { type: String, default: undefined },
  },
  emits: ["success", "error", "close"],
  setup(props, { emit }) {
    const container = ref<HTMLElement | null>(null);
    let handle: ConnectButtonHandle | null = null;

    const mount = () => {
      handle?.destroy();
      handle = null;
      if (!container.value) return;
      handle = mountConnectButton(
        container.value,
        optionsFromWrapperProps(
          { ...props },
          {
            onSuccess: () => emit("success"),
            onError: (error) => emit("error", error),
            onClose: () => emit("close"),
          },
        ),
      );
    };

    onMounted(mount);
    watch(
      () => [
        props.authorizeUrl,
        props.appTheme,
        props.label,
        props.variant,
        props.theme,
        JSON.stringify(props.platforms ?? []),
        props.moreCount,
        props.description,
        props.accentColor,
        props.connectedLabel,
      ],
      mount,
    );
    onBeforeUnmount(() => {
      handle?.destroy();
      handle = null;
    });

    return () => h("div", { ref: container });
  },
});
