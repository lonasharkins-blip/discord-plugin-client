import { Strings } from "@core/i18n";
import AddonPage from "@core/ui/components/AddonPage";
import PluginCard from "@core/ui/settings/pages/Plugins/components/PluginCard";
import { VdPluginManager } from "@core/vendetta/plugins";
import { useProxy } from "@core/vendetta/storage";
import {
  isCorePlugin,
  isPluginInstalled,
  pluginSettings,
  registeredPlugins,
} from "@lib/addons/plugins";
import { Author } from "@lib/addons/types";
import { findAssetId } from "@lib/api/assets";
import { useObservable } from "@lib/api/storage";
import { showToast } from "@lib/ui/toasts";
import { lazyDestructure } from "@lib/utils/lazy";
import { findByProps } from "@metro";
import { Card, Text } from "@metro/common/components";
import { ComponentProps } from "react";

import { UnifiedPluginModel } from "./models";
import unifyBunnyPlugin from "./models/bunny";
import unifyVdPlugin from "./models/vendetta";

const { openAlert } = lazyDestructure(() =>
  findByProps("openAlert", "dismissAlert"),
);
const { AlertModal, AlertActions, AlertActionButton } = lazyDestructure(() =>
  findByProps("AlertModal", "AlertActions"),
);

interface PluginPageProps
  extends Partial<ComponentProps<typeof AddonPage<UnifiedPluginModel>>> {
  useItems: () => unknown[];
}

function PluginPage(props: PluginPageProps) {
  const items = props.useItems();

  return (
    <AddonPage<UnifiedPluginModel>
      CardComponent={PluginCard}
      title={Strings.PLUGINS}
      searchKeywords={[
        "name",
        "description",
        (p) =>
          p.authors
            ?.map((a: Author | string) => (typeof a === "string" ? a : a.name))
            .join() || "",
      ]}
      sortOptions={{
        "Nome (A-Z)": (a, b) => a.name.localeCompare(b.name),
        "Nome (Z-A)": (a, b) => b.name.localeCompare(a.name),
      }}
      safeModeHint={{ message: Strings.SAFE_MODE_NOTICE_PLUGINS }}
      items={items}
      {...props}
    />
  );
}

export default function Plugins() {
  return (
    <PluginPage
      useItems={() => {
        useProxy(VdPluginManager.plugins);
        useObservable([pluginSettings]);

        const internalPlugins = [...registeredPlugins.values()]
          .filter((p) => isPluginInstalled(p.id) && isCorePlugin(p.id))
          .map(unifyBunnyPlugin);

        const urlPlugins = Object.values(VdPluginManager.plugins).map(unifyVdPlugin);

        const repositoryPlugins = [...registeredPlugins.values()]
          .filter((p) => isPluginInstalled(p.id) && !isCorePlugin(p.id))
          .map(unifyBunnyPlugin);

        return [...internalPlugins, ...urlPlugins, ...repositoryPlugins];
      }}
      installAction={{
        label: "Instalar plugin por URL",
        fetchFn: async (url: string) => {
          const pluginUrl = url.trim();

          if (!/^https?:\/\//i.test(pluginUrl)) {
            throw new Error("Use uma URL começando com http:// ou https://");
          }

          openAlert(
            "plugin-install-confirmation",
            <AlertModal
              title="Instalar plugin?"
              content="Plugins externos executam código dentro do Discord. Instale apenas plugins de fontes em que você confia."
              extraContent={
                <Card>
                  <Text variant="text-md/bold">{pluginUrl}</Text>
                </Card>
              }
              actions={
                <AlertActions>
                  <AlertActionButton
                    text="Instalar"
                    variant="primary"
                    onPress={async () => {
                      try {
                        await VdPluginManager.installPlugin(pluginUrl);
                        showToast("Plugin instalado", findAssetId("Check"));
                      } catch (e) {
                        openAlert(
                          "plugin-install-failed",
                          <AlertModal
                            title="Falha ao instalar"
                            content="Não foi possível instalar esse plugin."
                            extraContent={
                              <Card>
                                <Text variant="text-md/normal">
                                  {e instanceof Error ? e.message : String(e)}
                                </Text>
                              </Card>
                            }
                            actions={
                              <AlertActionButton text="OK" variant="primary" />
                            }
                          />,
                        );
                      }
                    }}
                  />
                  <AlertActionButton text="Cancelar" variant="secondary" />
                </AlertActions>
              }
            />,
          );
        },
      }}
    />
  );
}
