import { CardWrapper } from "@core/ui/components/AddonCard";
import { UnifiedPluginModel } from "@core/ui/settings/pages/Plugins/models";
import { usePluginCardStyles } from "@core/ui/settings/pages/Plugins/usePluginCardStyles";
import { findAssetId } from "@lib/api/assets";
import { isCorePlugin } from "@lib/addons/plugins";
import { NavigationNative, tokens } from "@metro/common";
import {
  Card,
  IconButton,
  Stack,
  TableSwitch,
  Text,
} from "@metro/common/components";
import { showSheet } from "@ui/sheets";
import chroma from "chroma-js";
import { createContext, useContext, useMemo, useReducer } from "react";
import { Image, View } from "react-native";

const CardContext = createContext<{
  plugin: UnifiedPluginModel;
  result: Fuzzysort.KeysResult<UnifiedPluginModel>;
}>(null!);
const useCardContext = () => useContext(CardContext);

function getHighlightColor(): import("react-native").ColorValue {
  return chroma(tokens.unsafe_rawColors.YELLOW_300).alpha(0.3).hex();
}

function Title() {
  const styles = usePluginCardStyles();
  const { plugin, result } = useCardContext();

  const highlightedNode = result[0].highlight((m, i) => (
    <Text key={i} style={{ backgroundColor: getHighlightColor() }}>
      {m}
    </Text>
  ));

  const icon = plugin.icon && findAssetId(plugin.icon);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {icon && <Image style={styles.smallIcon} source={icon} />}
      <Text numberOfLines={1} variant="heading-lg/semibold">
        {highlightedNode.length ? highlightedNode : plugin.name}
      </Text>
    </View>
  );
}

function Authors() {
  const { plugin, result } = useCardContext();

  if (!plugin.authors) return null;

  const highlightedNode = result[2].highlight((m, i) => (
    <Text key={i} style={{ backgroundColor: getHighlightColor() }}>
      {m}
    </Text>
  ));

  const authorText =
    highlightedNode.length > 0
      ? highlightedNode
      : plugin.authors.map((a) => a.name).join(", ");

  return (
    <Text variant="text-sm/semibold" color="text-muted">
      por {authorText}
    </Text>
  );
}

function Description() {
  const { plugin, result } = useCardContext();

  const highlightedNode = result[1].highlight((m, i) => (
    <Text key={i} style={{ backgroundColor: getHighlightColor() }}>
      {m}
    </Text>
  ));

  return (
    <Text variant="text-md/medium">
      {highlightedNode.length ? highlightedNode : plugin.description}
    </Text>
  );
}

function Actions() {
  const { plugin } = useCardContext();
  const navigation = NavigationNative.useNavigation();

  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <IconButton
        size="sm"
        variant="secondary"
        icon={findAssetId("WrenchIcon")}
        disabled={!plugin.getPluginSettingsComponent()}
        onPress={() =>
          navigation.push("PUPU_CUSTOM_PAGE", {
            title: plugin.name,
            render: plugin.getPluginSettingsComponent(),
          })
        }
      />
      <IconButton
        size="sm"
        variant="secondary"
        icon={findAssetId("CircleInformationIcon-primary")}
        onPress={() =>
          void showSheet(
            "PluginInfoActionSheet",
            plugin.resolveSheetComponent(),
            { plugin, navigation },
          )
        }
      />
    </View>
  );
}

export default function PluginCard({
  result,
  item: plugin,
}: CardWrapper<UnifiedPluginModel>) {
  plugin.usePluginState();

  const [, forceUpdate] = useReducer((value: number) => value + 1, 0);
  const cardContextValue = useMemo(() => ({ plugin, result }), [plugin, result]);
  const core = isCorePlugin(plugin.id);

  return (
    <CardContext.Provider value={cardContextValue}>
      <Card>
        <Stack spacing={16}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ flexShrink: 1 }}>
              <Title />
              <Authors />
            </View>
            <View>
              <Stack spacing={12} direction="horizontal">
                <Actions />
                <View style={core ? { opacity: 0.5 } : undefined}>
                  <TableSwitch
                    value={core ? true : plugin.isEnabled()}
                    disabled={core}
                    onValueChange={(enabled: boolean) => {
                      if (!core) {
                        plugin.toggle(enabled);
                        forceUpdate();
                      }
                    }}
                  />
                </View>
              </Stack>
            </View>
          </View>
          <Description />
        </Stack>
      </Card>
    </CardContext.Provider>
  );
}
