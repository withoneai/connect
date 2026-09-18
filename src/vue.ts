/**
 * Vue 3: `import { ConnectButton } from "@withone/connect/vue"`.
 *
 *   <ConnectButton
 *     authorize-url="/api/one/authorize"
 *     :platforms="['stripe', 'notion']"
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
  mountConnectButton,
  optionsFromProps,
  propsIdentity,
  type ConnectButtonHandle,
  type ConnectButtonPlatformInput,
  type ConnectButtonVariant,
  type OneConnectTheme,
} from "@withone/connect";

export const ConnectButton = defineComponent({
  name: "OneConnectButton",
  props: {
    authorizeUrl: { type: String, required: true },
    appTheme: { type: String as PropType<OneConnectTheme>, default: undefined },
    label: { type: String, default: undefined },
    variant: {
      type: String as PropType<ConnectButtonVariant>,
      default: undefined,
    },
    theme: { type: String as PropType<OneConnectTheme>, default: undefined },
    platforms: {
      type: Array as PropType<ConnectButtonPlatformInput[]>,
      default: undefined,
    },
    moreCount: { type: Number, default: undefined },
    description: { type: String, default: undefined },
    accentColor: { type: String, default: undefined },
    connectedLabel: { type: String, default: undefined },
  },
  emits: {
    success: () => true,
    error: (message: string) => typeof message === "string",
  },
  setup(props, { emit }) {
    const container = ref<HTMLElement | null>(null);
    let handle: ConnectButtonHandle | null = null;

    const mount = () => {
      handle?.destroy();
      handle = null;
      if (!container.value) return;
      handle = mountConnectButton(
        container.value,
        optionsFromProps(
          { ...props },
          {
            onSuccess: () => emit("success"),
            onError: (message) => emit("error", message),
          },
        ),
      );
    };

    onMounted(mount);
    watch(() => propsIdentity({ ...props }), mount);
    onBeforeUnmount(() => {
      handle?.destroy();
      handle = null;
    });

    return () => h("div", { ref: container });
  },
});
