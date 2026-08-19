import { NavigationNative, React, clipboard } from "@metro/common";
import {
    ActionSheet,
    AlertActions,
    AlertModal,
    Button,
    Card,
    FlashList,
    IconButton,
    Stack,
    TableRow,
    TableRowGroup,
    Text,
} from "@metro/common/components";
import { VdPluginManager } from "@core/vendetta/plugins";
import { AlertActionButton } from "@lib/ui/components/wrappers";
import { dismissAlert, openAlert } from "@lib/ui/alerts";
import { hideSheet, showSheet } from "@lib/ui/sheets";
import { findAssetId } from "@lib/api/assets";
import safeFetch from "@lib/utils/safeFetch";
import { lazyDestructure } from "@lib/utils/lazy";
import { findByProps } from "@metro";
import Search from "@ui/components/Search";
import { showToast } from "@ui/toasts";
import { View } from "react-native";

const { showSimpleActionSheet } = lazyDestructure(() =>
    findByProps("showSimpleActionSheet"),
);
const { hideActionSheet } = findByProps("hideActionSheet");

interface PluginData {
    name: string;
    description: string;
    authors: string[];
    installUrl: string;
    status: "working" | "broken" | "warning" | string;
    sourceUrl?: string;
    warningMessage?: string;
}

const PLUGIN_URL =
    "https://raw.githubusercontent.com/Purple-EyeZ/Plugins-List/refs/heads/main/src/plugins-data.json";

function normalizePluginUrl(url: string) {
    return url.endsWith("/") ? url : `${url}/`;
}

function PluginActions({
    plugin,
    installing,
    setInstalling,
    onChanged,
}: {
    plugin: PluginData;
    installing: Set<string>;
    setInstalling: React.Dispatch<React.SetStateAction<Set<string>>>;
    onChanged: () => void;
}) {
    const pluginUrl = normalizePluginUrl(plugin.installUrl);
    const [installed, setInstalled] = React.useState(() =>
        Boolean(VdPluginManager.plugins[pluginUrl]),
    );

    React.useEffect(() => {
        setInstalled(Boolean(VdPluginManager.plugins[pluginUrl]));
    }, [pluginUrl]);

    const install = async () => {
        if (installing.has(pluginUrl)) return;

        setInstalling((previous) => {
            const next = new Set(previous);
            next.add(pluginUrl);
            return next;
        });

        try {
            await VdPluginManager.installPlugin(pluginUrl, true);
            setInstalled(true);
            showToast(`${plugin.name} instalado.`, findAssetId("CheckIcon"));
            onChanged();
        } catch (error) {
            showToast(
                error instanceof Error ? error.message : String(error),
                findAssetId("CircleXIcon-primary"),
            );
        } finally {
            setInstalling((previous) => {
                const next = new Set(previous);
                next.delete(pluginUrl);
                return next;
            });
        }
    };

    const remove = async () => {
        try {
            await VdPluginManager.removePlugin(pluginUrl);
            setInstalled(false);
            showToast(`${plugin.name} removido.`, findAssetId("TrashIcon"));
            onChanged();
        } catch (error) {
            showToast(
                error instanceof Error ? error.message : String(error),
                findAssetId("CircleXIcon-primary"),
            );
        }
    };

    const promptInstall = () => {
        const needsWarning =
            (plugin.status && plugin.status !== "working") ||
            Boolean(plugin.warningMessage?.trim());

        if (!needsWarning) {
            void install();
            return;
        }

        const warnings: string[] = [];

        if (plugin.status === "broken") {
            warnings.push("Este plugin está marcado como quebrado e pode não funcionar.");
        } else if (plugin.status === "warning") {
            warnings.push("Este plugin possui um aviso de compatibilidade.");
        } else if (plugin.status && plugin.status !== "working") {
            warnings.push(`Status informado: ${plugin.status}`);
        }

        if (plugin.warningMessage) warnings.push(plugin.warningMessage);

        openAlert(
            "plugin-library-install-warning",
            <AlertModal
                title="Atenção"
                content="Este plugin pode não funcionar como esperado."
                extraContent={
                    <Text variant="text-sm/normal" color="text-muted">
                        {warnings.join("\n\n")}
                    </Text>
                }
                actions={
                    <AlertActions>
                        <AlertActionButton
                            text="Instalar mesmo assim"
                            variant="primary"
                            onPress={() => {
                                dismissAlert("plugin-library-install-warning");
                                void install();
                            }}
                        />
                        <AlertActionButton
                            text="Cancelar"
                            variant="secondary"
                            onPress={() =>
                                dismissAlert("plugin-library-install-warning")
                            }
                        />
                    </AlertActions>
                }
            />,
        );
    };

    const openMenu = () => {
        const key = `plugin-library-menu-${pluginUrl}`;

        showSheet(key, () => (
            <ActionSheet>
                <TableRowGroup title="Plugin">
                    <TableRow
                        label="Copiar link de instalação"
                        icon={<TableRow.Icon source={findAssetId("CopyIcon")} />}
                        onPress={() => {
                            clipboard.setString(plugin.installUrl);
                            hideSheet(key);
                        }}
                    />
                    {plugin.sourceUrl ? (
                        <TableRow
                            label="Copiar código-fonte"
                            icon={<TableRow.Icon source={findAssetId("LinkIcon")} />}
                            onPress={() => {
                                clipboard.setString(plugin.sourceUrl!);
                                hideSheet(key);
                            }}
                        />
                    ) : null}
                </TableRowGroup>
            </ActionSheet>
        ));
    };

    const isInstalling = installing.has(pluginUrl);

    return (
        <Stack spacing={8} direction="horizontal">
            <IconButton
                size="sm"
                variant="secondary"
                icon={findAssetId("MoreHorizontalIcon")}
                onPress={openMenu}
            />
            <Button
                size="sm"
                loading={isInstalling}
                disabled={isInstalling}
                text={
                    installed
                        ? "Remover"
                        : isInstalling
                          ? "Instalando..."
                          : "Instalar"
                }
                variant={installed ? "destructive" : "primary"}
                icon={findAssetId(installed ? "TrashIcon" : "DownloadIcon")}
                onPress={installed ? remove : promptInstall}
            />
        </Stack>
    );
}

function PluginCard({
    plugin,
    installing,
    setInstalling,
    onChanged,
}: {
    plugin: PluginData;
    installing: Set<string>;
    setInstalling: React.Dispatch<React.SetStateAction<Set<string>>>;
    onChanged: () => void;
}) {
    let statusText = plugin.status || "unknown";
    let statusColor: any = "text-normal";

    if (plugin.status === "working") {
        statusText = "funcionando";
        statusColor = "#4ADE80";
    } else if (plugin.status === "warning") {
        statusText = "atenção";
        statusColor = "#F59E0B";
    } else if (plugin.status === "broken") {
        statusText = "quebrado";
        statusColor = "#EF4444";
    }

    return (
        <Card>
            <Stack spacing={12}>
                <View
                    style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 10,
                    }}
                >
                    <View style={{ flex: 1, flexShrink: 1 }}>
                        <Text numberOfLines={1} variant="heading-lg/semibold">
                            {plugin.name}
                        </Text>
                        <Text variant="text-sm/semibold" color="text-muted">
                            por {plugin.authors?.join(", ") || "Desconhecido"}
                        </Text>
                        <Text variant="text-sm/semibold" style={{ color: statusColor }}>
                            Status: {statusText}
                        </Text>
                    </View>

                    <PluginActions
                        plugin={plugin}
                        installing={installing}
                        setInstalling={setInstalling}
                        onChanged={onChanged}
                    />
                </View>

                <Text variant="text-md/medium">{plugin.description}</Text>

                {plugin.warningMessage ? (
                    <Text variant="text-sm/medium" color="text-muted">
                        Aviso: {plugin.warningMessage}
                    </Text>
                ) : null}
            </Stack>
        </Card>
    );
}

enum Sort {
    Newest = "Mais recentes",
    Oldest = "Mais antigos",
    NameAZ = "Nome (A–Z)",
    NameZA = "Nome (Z–A)",
    WorkingFirst = "Funcionando primeiro",
    BrokenFirst = "Quebrados primeiro",
}

export default function PluginBrowser() {
    const navigation = NavigationNative.useNavigation();
    const [plugins, setPlugins] = React.useState<PluginData[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [installing, setInstalling] = React.useState<Set<string>>(new Set());
    const [sort, setSort] = React.useState<Sort>(Sort.Newest);
    const [, forceUpdate] = React.useReducer((value: number) => value + 1, 0);

    React.useEffect(() => {
        navigation.setOptions({ title: "Biblioteca de Plugins" });
    }, [navigation]);

    const fetchPlugins = React.useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await safeFetch(PLUGIN_URL, { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const list = Array.isArray(data)
                ? data
                : Array.isArray(data?.OFFICIAL_PLUGINS)
                  ? data.OFFICIAL_PLUGINS
                  : [];

            setPlugins(list as PluginData[]);
        } catch (err) {
            setPlugins([]);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        void fetchPlugins();
    }, [fetchPlugins]);

    const filteredPlugins = React.useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const list = query
            ? plugins.filter(
                  (plugin) =>
                      plugin.name.toLowerCase().includes(query) ||
                      plugin.description.toLowerCase().includes(query) ||
                      plugin.authors?.some((author) =>
                          author.toLowerCase().includes(query),
                      ),
              )
            : plugins;

        const statusPriority = (plugin: PluginData, brokenFirst = false) => {
            if (brokenFirst) return plugin.status === "broken" ? 0 : 1;
            return plugin.status === "working" || plugin.status === "warning" ? 0 : 1;
        };

        switch (sort) {
            case Sort.Newest:
                return [...list].reverse();
            case Sort.Oldest:
                return [...list];
            case Sort.NameAZ:
                return [...list].sort((a, b) => a.name.localeCompare(b.name));
            case Sort.NameZA:
                return [...list].sort((a, b) => b.name.localeCompare(a.name));
            case Sort.WorkingFirst:
                return [...list].sort(
                    (a, b) =>
                        statusPriority(a) - statusPriority(b) ||
                        a.name.localeCompare(b.name),
                );
            case Sort.BrokenFirst:
                return [...list].sort(
                    (a, b) =>
                        statusPriority(a, true) - statusPriority(b, true) ||
                        a.name.localeCompare(b.name),
                );
            default:
                return list;
        }
    }, [plugins, searchQuery, sort]);

    if (error) {
        return (
            <View
                style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    paddingHorizontal: 12,
                }}
            >
                <Card>
                    <Stack spacing={10}>
                        <Text variant="heading-lg/bold">
                            Não foi possível carregar a biblioteca
                        </Text>
                        <Text variant="text-sm/medium" color="text-muted">
                            {error}
                        </Text>
                        <Button
                            size="md"
                            text="Tentar novamente"
                            icon={findAssetId("RetryIcon")}
                            onPress={fetchPlugins}
                        />
                    </Stack>
                </Card>
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Search
                        placeholder="Buscar plugins..."
                        isRound
                        onChangeText={setSearchQuery}
                        style={{ flex: 1 }}
                    />
                    <IconButton
                        size="md"
                        variant="tertiary"
                        icon={findAssetId("MoreVerticalIcon")}
                        onPress={() =>
                            showSimpleActionSheet({
                                key: "PluginLibrarySortOptions",
                                header: {
                                    title: "Ordenar plugins",
                                    onClose: () =>
                                        hideActionSheet("PluginLibrarySortOptions"),
                                },
                                options: Object.values(Sort).map((value) => ({
                                    label: value,
                                    onPress: () => setSort(value),
                                })),
                            })
                        }
                    />
                </View>

                <Text
                    variant="text-sm/medium"
                    color="text-muted"
                    style={{ marginTop: 8 }}
                >
                    {loading
                        ? "Carregando plugins..."
                        : `${filteredPlugins.length} plugin${filteredPlugins.length === 1 ? "" : "s"}`}
                </Text>
            </View>

            <FlashList
                data={loading ? [] : filteredPlugins}
                refreshing={loading}
                onRefresh={fetchPlugins}
                estimatedItemSize={200}
                contentContainerStyle={{ paddingBottom: 90, paddingHorizontal: 5 }}
                ListHeaderComponent={
                    <View style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
                        <Card border="strong">
                            <Text variant="text-sm/medium" color="text-muted">
                                Esta biblioteca reúne plugins de fontes externas. Instale apenas plugins em que você confia.
                            </Text>
                        </Card>
                    </View>
                }
                renderItem={({ item }: { item: PluginData }) => (
                    <View style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
                        <PluginCard
                            plugin={item}
                            installing={installing}
                            setInstalling={setInstalling}
                            onChanged={forceUpdate}
                        />
                    </View>
                )}
            />
        </View>
    );
}
