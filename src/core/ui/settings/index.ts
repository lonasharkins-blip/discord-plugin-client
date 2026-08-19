import PupuIcon from "@assets/icons/kettu.png";
import { Strings } from "@core/i18n";
import { findAssetId } from "@lib/api/assets";
import { registerSection } from "@ui/settings";

export { PupuIcon };

export default function initSettings() {
    registerSection({
        name: "Plugins",
        items: [
            {
                key: "BUNNY_PLUGINS",
                title: () => Strings.PLUGINS,
                icon: findAssetId("AppsIcon"),
                render: () => import("@core/ui/settings/pages/Plugins")
            },
            {
                key: "KETTU_BROWSER",
                title: () => Strings.BROWSER,
                icon: findAssetId("ChannelListMagnifyingGlassIcon"),
                render: () => import("@core/ui/settings/pages/PluginBrowser")
            },
            {
                key: "BUNNY_DEVELOPER",
                title: () => Strings.DEVELOPER,
                icon: findAssetId("WrenchIcon"),
                render: () => import("@core/ui/settings/pages/Developer")
            }
        ]
    });

    registerSection({
        name: "Bunny",
        items: []
    });

    registerSection({
        name: "Revenge",
        items: []
    });

    registerSection({
        name: "Vendetta",
        items: []
    });
}
