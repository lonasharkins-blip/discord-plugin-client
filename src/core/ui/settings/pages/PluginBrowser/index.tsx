import { NavigationNative, React } from "@metro/common";
import {
    Button,
    Card,
    FlashList,
    Stack,
    Text,
    TextInput,
} from "@metro/common/components";
import { VdPluginManager } from "@core/vendetta/plugins";
import { findAssetId } from "@lib/api/assets";
import safeFetch from "@lib/utils/safeFetch";
import { showToast } from "@ui/toasts";
import { View } from "react-native";

interface CatalogPlugin {
    id: string;
    name: string;
    description: string;
    authors: string[];
    version: string;
    installUrl: string;
}

const CATALOG_URL = "https://raw.githubusercontent.com/lonasharkins-blip/discord-plugin-client/main/catalog/plugins.json";

function normalizePluginUrl(url: string) {
    return url.endsWith("/") ? url : `${url}/`;
}

function PluginCatalogCard({
    plugin,
    onChanged,
}: {
    plugin: CatalogPlugin;
    onChanged: () => void;
}) {
    const pluginUrl = normalizePluginUrl(plugin.installUrl);
    const installed = Boolean(VdPluginManager.plugins[pluginUrl]);
    const [busy, setBusy] = React.useState(false);

    const install = async () => {
        if (busy) return;
        setBusy(true);

        try {
            await VdPluginManager.installPlugin(pluginUrl, true);
            showToast(`${plugin.name} instalado.`, findAssetId("Check"));
            onChanged();
        } catch (error) {
            showToast(
                error instanceof Error ? error.message : String(error),
                findAssetId("CircleXIcon-primary"),
            );
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (busy) return;
        setBusy(true);

        try {
            await VdPluginManager.removePlugin(pluginUrl);
            showToast(`${plugin.name} removido.`, findAssetId("TrashIcon"));
            onChanged();
        } catch (error) {
            showToast(
                error instanceof Error ? error.message : String(error),
                findAssetId("CircleXIcon-primary"),
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card>
            <Stack spacing={12}>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12,
                    }}
                >
                    <View style={{ flex: 1, flexShrink: 1 }}>
                        <Text variant="heading-lg/semibold" numberOfLines={1}>
                            {plugin.name}
                        </Text>
                        <Text variant="text-sm/semibold" color="text-muted">
                            por {plugin.authors.join(", ")} • v{plugin.version}
                        </Text>
                    </View>

                    <Button
                        size="sm"
                        text={installed ? "Remover" : busy ? "Instalando..." : "Instalar"}
                        variant={installed ? "destructive" : "primary"}
                        disabled={busy}
                        loading={busy}
                        icon={findAssetId(installed ? "TrashIcon" : "DownloadIcon")}
                        onPress={installed ? remove : install}
                    />
                </View>

                <Text variant="text-md/medium">{plugin.description}</Text>
            </Stack>
        </Card>
    );
}

export default function PluginBrowser() {
    const navigation = NavigationNative.useNavigation();
    const [plugins, setPlugins] = React.useState<CatalogPlugin[]>([]);
    const [query, setQuery] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [, forceUpdate] = React.useReducer((value: number) => value + 1, 0);

    React.useEffect(() => {
        navigation.setOptions({ title: "Biblioteca de Plugins" });
    }, [navigation]);

    const loadCatalog = React.useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await safeFetch(CATALOG_URL, { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`Falha ao carregar catálogo: HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!Array.isArray(data)) {
                throw new Error("O catálogo de plugins possui um formato inválido.");
            }

            setPlugins(data as CatalogPlugin[]);
        } catch (err) {
            setPlugins([]);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        loadCatalog();
    }, [loadCatalog]);

    const filteredPlugins = React.useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return plugins;

        return plugins.filter((plugin) => {
            return (
                plugin.name.toLowerCase().includes(normalizedQuery) ||
                plugin.description.toLowerCase().includes(normalizedQuery) ||
                plugin.version.toLowerCase().includes(normalizedQuery) ||
                plugin.authors.some((author) =>
                    author.toLowerCase().includes(normalizedQuery),
                )
            );
        });
    }, [plugins, query]);

    if (error) {
        return (
            <View
                style={{
                    flex: 1,
                    justifyContent: "center",
                    paddingHorizontal: 12,
                }}
            >
                <Card>
                    <Stack spacing={12}>
                        <Text variant="heading-lg/bold">Não foi possível carregar a biblioteca</Text>
                        <Text variant="text-sm/medium" color="text-muted">
                            {error}
                        </Text>
                        <Button
                            size="md"
                            text="Tentar novamente"
                            icon={findAssetId("RetryIcon")}
                            onPress={loadCatalog}
                        />
                    </Stack>
                </Card>
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 8 }}>
                <Stack spacing={10}>
                    <TextInput
                        size="md"
                        placeholder="Buscar plugins..."
                        value={query}
                        onChange={(value: string) => setQuery(value)}
                    />

                    <Text variant="text-sm/medium" color="text-muted">
                        {loading
                            ? "Carregando plugins..."
                            : `${filteredPlugins.length} plugin${filteredPlugins.length === 1 ? "" : "s"}`}
                    </Text>
                </Stack>
            </View>

            <FlashList
                data={loading ? [] : filteredPlugins}
                contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 24 }}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                renderItem={({ item }: { item: CatalogPlugin }) => (
                    <PluginCatalogCard
                        plugin={item}
                        onChanged={() => forceUpdate()}
                    />
                )}
                ListEmptyComponent={() => (
                    <View style={{ paddingVertical: 32 }}>
                        <Text
                            variant="text-md/medium"
                            color="text-muted"
                            style={{ textAlign: "center" }}
                        >
                            {loading
                                ? "Carregando..."
                                : query
                                  ? "Nenhum plugin encontrado."
                                  : "Ainda não há plugins no catálogo."}
                        </Text>
                    </View>
                )}
            />
        </View>
    );
}
