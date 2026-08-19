import { showConfirmationAlert } from "@core/vendetta/alerts";
import { VdPluginManager } from "@core/vendetta/plugins";
import { purgeStorage as purgeVdStorage } from "@core/vendetta/storage";
import {
  isCorePlugin,
  registeredPlugins,
  refreshPlugin,
  uninstallPlugin,
  updateAndWritePlugin,
} from "@lib/addons/plugins";
import { findAssetId } from "@lib/api/assets";
import { purgeStorage } from "@lib/api/storage";
import { hideSheet } from "@lib/ui/sheets";
import { showToast } from "@lib/ui/toasts";
import { clipboard } from "@metro/common";
import { ActionSheet, Card, IconButton, Text } from "@metro/common/components";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { PluginInfoActionSheetProps } from "./common";
import TitleComponent from "./TitleComponent";

function PluginInfoIconButton(props) {
  const { onPress } = props;
  props.onPress &&= () => {
    hideSheet("PluginInfoActionSheet");
    onPress?.();
  };
  return <IconButton {...props} />;
}

export default function PluginInfoActionSheet({
  plugin,
  navigation,
}: PluginInfoActionSheetProps) {
  plugin.usePluginState();
  const [loading, setLoading] = useState(false);

  const isUrlPlugin = plugin.id.includes("/");
  const isInternalPlugin = !isUrlPlugin && isCorePlugin(plugin.id);

  const getRepositoryUrl = () => {
    const manifest = registeredPlugins.get(plugin.id) as any;
    return manifest?.parentRepository as string | undefined;
  };

  const copyPluginUrl = () => {
    const url = isUrlPlugin ? plugin.id : getRepositoryUrl() ?? plugin.id;
    clipboard.setString(url);
    showToast("URL copiada", findAssetId("toast_copy_link"));
  };

  const updatePlugin = async () => {
    setLoading(true);

    try {
      if (isUrlPlugin) {
        const current = VdPluginManager.plugins[plugin.id];
        const wasEnabled = current?.enabled ?? false;

        if (wasEnabled) VdPluginManager.stopPlugin(plugin.id, false);
        await VdPluginManager.fetchPlugin(plugin.id);
        if (wasEnabled) await VdPluginManager.startPlugin(plugin.id);
      } else {
        const repoUrl = getRepositoryUrl();
        if (!repoUrl) throw new Error("Fonte do plugin não encontrada");

        if (plugin.isEnabled()) {
          await refreshPlugin(plugin.id, repoUrl);
        } else {
          await updateAndWritePlugin(repoUrl, plugin.id, true);
        }
      }

      showToast("Plugin atualizado", findAssetId("Check"));
    } catch (e) {
      showToast(
        `Falha ao atualizar: ${e instanceof Error ? e.message : String(e)}`,
        findAssetId("Small"),
      );
    } finally {
      setLoading(false);
    }
  };

  const clearPluginData = () => {
    showConfirmationAlert({
      title: "Limpar dados",
      content:
        "Isso apaga as configurações e os dados salvos deste plugin. Deseja continuar?",
      confirmText: "Limpar",
      confirmColor: "red",
      cancelText: "Cancelar",
      onConfirm: async () => {
        hideSheet("PluginInfoActionSheet");

        try {
          if (isUrlPlugin) {
            const current = VdPluginManager.plugins[plugin.id];
            const wasEnabled = current?.enabled ?? false;

            if (wasEnabled) VdPluginManager.stopPlugin(plugin.id, false);
            await purgeVdStorage(plugin.id);
            if (wasEnabled) await VdPluginManager.startPlugin(plugin.id);
          } else {
            await purgeStorage(`plugins/storage/${plugin.id}.json`);
          }

          showToast("Dados do plugin apagados", findAssetId("Check"));
        } catch (e) {
          showToast("Não foi possível limpar os dados", findAssetId("Small"));
        }
      },
    });
  };

  const removePlugin = () => {
    if (isInternalPlugin) {
      showToast("Plugins internos não podem ser removidos", findAssetId("Small"));
      return;
    }

    showConfirmationAlert({
      title: "Remover plugin",
      content: `Deseja remover “${plugin.name}”?`,
      confirmText: "Remover",
      confirmColor: "red",
      cancelText: "Cancelar",
      onConfirm: async () => {
        hideSheet("PluginInfoActionSheet");

        try {
          if (isUrlPlugin) {
            await VdPluginManager.removePlugin(plugin.id);
          } else {
            await uninstallPlugin(plugin.id);
          }

          showToast("Plugin removido", findAssetId("Check"));
        } catch (e) {
          showToast(
            `Falha ao remover: ${e instanceof Error ? e.message : String(e)}`,
            findAssetId("Small"),
          );
        }
      },
    });
  };

  return (
    <ActionSheet>
      <ScrollView contentContainerStyle={{ gap: 12, marginBottom: 12 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 24,
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <TitleComponent plugin={plugin} />
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 22,
            paddingHorizontal: 4,
          }}
        >
          <PluginInfoIconButton
            label="Configurar"
            variant="secondary"
            disabled={!plugin.getPluginSettingsComponent()}
            icon={findAssetId("WrenchIcon")}
            onPress={() => {
              navigation.push("PUPU_CUSTOM_PAGE", {
                title: plugin.name,
                render: plugin.getPluginSettingsComponent(),
              });
            }}
          />

          {!isInternalPlugin && (
            <PluginInfoIconButton
              label="Atualizar"
              variant="secondary"
              icon={findAssetId("RetryIcon")}
              onPress={updatePlugin}
              disabled={loading}
            />
          )}

          {!isInternalPlugin && (
            <PluginInfoIconButton
              label="Copiar URL"
              variant="secondary"
              icon={findAssetId("LinkIcon")}
              onPress={copyPluginUrl}
            />
          )}

          <PluginInfoIconButton
            label="Limpar dados"
            variant="secondary"
            icon={findAssetId("FileIcon")}
            onPress={clearPluginData}
          />

          {!isInternalPlugin && (
            <PluginInfoIconButton
              label="Remover"
              variant="secondary"
              icon={findAssetId("TrashIcon")}
              onPress={removePlugin}
            />
          )}
        </View>

        <Card>
          <Text
            variant="text-md/semibold"
            color="text-primary"
            style={{ marginBottom: 4 }}
          >
            Descrição
          </Text>
          <Text variant="text-md/medium">{plugin.description}</Text>
        </Card>
      </ScrollView>
    </ActionSheet>
  );
}
