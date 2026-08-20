(function (plugin, pluginApi, metro, common, storageApi, toasts) {
  "use strict";

  const { storage } = pluginApi;
  const { find, findByProps, findByStoreName } = metro;
  const { React, ReactNative } = common;
  const { useProxy } = storageApi;
  const { showToast } = toasts;

  const FluxDispatcher = findByProps("dispatch", "subscribe");
  const MessageActions =
    findByProps("sendMessage", "receiveMessage") ||
    findByProps("sendMessage", "editMessage");
  const SelectedChannelStore =
    findByStoreName("SelectedChannelStore") ||
    findByProps("getChannelId", "getLastSelectedChannelId");
  const ChannelStore =
    findByStoreName("ChannelStore") ||
    findByProps("getChannel", "hasChannel");
  const GuildStore =
    findByStoreName("GuildStore") ||
    findByProps("getGuild", "getGuilds");

  function isDirectMethod(module, method) {
    try {
      const d = Object.getOwnPropertyDescriptor(module, method);
      return typeof d?.value === "function" && !d.get;
    } catch {
      return false;
    }
  }

  function isRestCandidate(module) {
    if (!module || typeof module !== "object") return false;
    return ["get", "post", "patch", "put", "delete"].every((m) => isDirectMethod(module, m));
  }

  let RestApi = null;
  try {
    RestApi =
      find((m) => isRestCandidate(m) && "request" in m) ||
      find(isRestCandidate) ||
      findByProps("get", "post", "patch", "put", "delete");
  } catch {}

  if (storage.enabled === undefined) storage.enabled = true;
  if (storage.sourceChannelId === undefined) storage.sourceChannelId = "";
  if (storage.destinationChannelId === undefined) storage.destinationChannelId = "";
  if (storage.forwardNew === undefined) storage.forwardNew = true;
  if (storage.historyDelayMs === undefined) storage.historyDelayMs = 700;
  if (storage.historyStatus === undefined) storage.historyStatus = "Aguardando.";
  if (storage.historyFetched === undefined) storage.historyFetched = 0;
  if (storage.historyForwarded === undefined) storage.historyForwarded = 0;
  if (storage.historyFailed === undefined) storage.historyFailed = 0;

  let running = false;
  let historyRunning = false;
  let cancelHistory = false;
  let sendQueue = Promise.resolve();
  const seenMessageIds = new Set();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function cleanChannelId(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const fromLink = text.match(/discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d{15,25})/i);
    if (fromLink) return fromLink[1];
    const id = text.match(/\d{15,25}/);
    return id ? id[0] : text;
  }

  function getChannelLabel(channelId) {
    if (!channelId) return "não definido";
    try {
      const channel = ChannelStore?.getChannel?.(channelId);
      if (!channel) return channelId;
      const guild = channel.guild_id ? GuildStore?.getGuild?.(channel.guild_id) : null;
      const channelName = channel.name ? `#${channel.name}` : channelId;
      return guild?.name ? `${guild.name} • ${channelName}` : channelName;
    } catch {
      return channelId;
    }
  }

  function getCurrentChannelId() {
    try {
      return (
        SelectedChannelStore?.getChannelId?.() ||
        SelectedChannelStore?.getLastSelectedChannelId?.() ||
        ""
      );
    } catch {
      return "";
    }
  }

  function rememberMessage(id) {
    if (!id || seenMessageIds.has(id)) return false;
    seenMessageIds.add(id);
    if (seenMessageIds.size > 500) {
      const oldest = seenMessageIds.values().next().value;
      if (oldest) seenMessageIds.delete(oldest);
    }
    return true;
  }

  function messageReference(message) {
    const ref = {
      type: 1,
      message_id: String(message.id),
      channel_id: String(message.channel_id || storage.sourceChannelId),
    };
    if (message.guild_id) ref.guild_id = String(message.guild_id);
    return ref;
  }

  async function forwardViaRest(message, destinationChannelId) {
    if (!RestApi?.post) return false;
    try {
      const result = await RestApi.post({
        url: `/channels/${destinationChannelId}/messages`,
        body: { message_reference: messageReference(message) },
        retries: 2,
      });
      return !!result;
    } catch {
      return false;
    }
  }

  async function forwardViaMessageActions(message, destinationChannelId) {
    if (!MessageActions?.sendMessage) return false;

    const ref = {
      type: 1,
      messageId: String(message.id),
      channelId: String(message.channel_id || storage.sourceChannelId),
    };
    if (message.guild_id) ref.guildId = String(message.guild_id);

    try {
      await Promise.resolve(
        MessageActions.sendMessage(destinationChannelId, {
          content: "",
          messageReference: ref,
        }),
      );
      return true;
    } catch {}

    try {
      await Promise.resolve(
        MessageActions.sendMessage(destinationChannelId, {
          content: "",
          message_reference: messageReference(message),
        }),
      );
      return true;
    } catch {}

    return false;
  }

  async function forwardNative(message, destinationChannelId) {
    if (await forwardViaRest(message, destinationChannelId)) return true;
    return await forwardViaMessageActions(message, destinationChannelId);
  }

  async function forwardWithRetry(message, destinationChannelId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (cancelHistory) return false;
      const ok = await forwardNative(message, destinationChannelId);
      if (ok) return true;
      if (attempt < 3) await sleep(1200 * attempt);
    }
    return false;
  }

  async function fetchAllHistory(sourceChannelId) {
    if (!RestApi?.get) throw new Error("API interna de histórico não encontrada.");

    const byId = new Map();
    let before = null;

    while (!cancelHistory) {
      const query = { limit: 100 };
      if (before) query.before = before;

      const response = await RestApi.get({
        url: `/channels/${sourceChannelId}/messages`,
        query,
        retries: 2,
      });

      const batch = Array.isArray(response?.body) ? response.body : [];
      if (!batch.length) break;

      for (const message of batch) {
        if (message?.id) byId.set(String(message.id), message);
      }

      storage.historyFetched = byId.size;
      storage.historyStatus = `Buscando histórico… ${byId.size} mensagens encontradas.`;

      before = String(batch[batch.length - 1]?.id || "");
      if (batch.length < 100 || !before) break;
      await sleep(250);
    }

    const messages = Array.from(byId.values());
    messages.sort((a, b) => {
      const aa = String(a?.id || "");
      const bb = String(b?.id || "");
      if (aa.length !== bb.length) return aa.length - bb.length;
      return aa < bb ? -1 : aa > bb ? 1 : 0;
    });
    return messages;
  }

  async function syncHistory() {
    if (historyRunning) {
      try { showToast("A sincronização já está em andamento.", 1); } catch {}
      return;
    }

    const source = cleanChannelId(storage.sourceChannelId);
    const destination = cleanChannelId(storage.destinationChannelId);

    if (!source || !destination) {
      try { showToast("Defina origem e destino primeiro.", 1); } catch {}
      return;
    }
    if (source === destination) {
      try { showToast("Origem e destino não podem ser iguais.", 1); } catch {}
      return;
    }
    if (!RestApi?.get) {
      storage.historyStatus = "Erro: não encontrei a API de histórico nesta versão do Discord.";
      try { showToast("API de histórico não encontrada.", 1); } catch {}
      return;
    }

    historyRunning = true;
    cancelHistory = false;
    storage.historyFetched = 0;
    storage.historyForwarded = 0;
    storage.historyFailed = 0;
    storage.historyStatus = "Buscando mensagens existentes…";

    try {
      const messages = await fetchAllHistory(source);

      if (cancelHistory) {
        storage.historyStatus = "Sincronização cancelada.";
        return;
      }

      storage.historyStatus = `Histórico carregado: ${messages.length}. Iniciando encaminhamento…`;

      for (let i = 0; i < messages.length && !cancelHistory; i++) {
        const message = messages[i];
        const ok = await forwardWithRetry(message, destination);

        if (ok) storage.historyForwarded += 1;
        else storage.historyFailed += 1;

        storage.historyStatus =
          `Encaminhando ${i + 1}/${messages.length} • ` +
          `enviadas: ${storage.historyForwarded} • falhas: ${storage.historyFailed}`;

        if (!cancelHistory && i < messages.length - 1) {
          await sleep(Math.max(350, Number(storage.historyDelayMs) || 700));
        }
      }

      storage.historyStatus = cancelHistory
        ? `Parado. Enviadas: ${storage.historyForwarded} • falhas: ${storage.historyFailed}`
        : `Concluído. Enviadas: ${storage.historyForwarded} • falhas: ${storage.historyFailed}`;

      try {
        showToast(cancelHistory ? "Sincronização parada." : "Histórico encaminhado.", 0);
      } catch {}
    } catch (error) {
      storage.historyStatus = `Erro: ${error?.message || String(error)}`;
      try { showToast("Falha ao sincronizar histórico.", 1); } catch {}
    } finally {
      historyRunning = false;
      cancelHistory = false;
    }
  }

  function stopHistory() {
    if (!historyRunning) {
      try { showToast("Nenhuma sincronização em andamento.", 1); } catch {}
      return;
    }
    cancelHistory = true;
    storage.historyStatus = "Parando sincronização…";
  }

  async function forwardNewMessage(message) {
    const source = cleanChannelId(storage.sourceChannelId);
    const destination = cleanChannelId(storage.destinationChannelId);

    if (!storage.enabled || !storage.forwardNew || !source || !destination) return;
    if (!message?.id || String(message.channel_id) !== source) return;
    if (source === destination || !rememberMessage(String(message.id))) return;

    const ok = await forwardNative(message, destination);
    if (!ok) console.log("[Channel Forwarder] Falha ao encaminhar mensagem nova", message.id);
  }

  function onMessageCreate(action) {
    const message = action?.message;
    if (!message) return;
    sendQueue = sendQueue
      .then(() => forwardNewMessage(message))
      .catch((error) => console.log("[Channel Forwarder] Falha:", error));
  }

  function startListener() {
    if (running || !FluxDispatcher?.subscribe) return;
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
    running = true;
  }

  function stopListener() {
    if (!running || !FluxDispatcher?.unsubscribe) return;
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
    running = false;
  }

  function ActionButton({ label, onPress, danger }) {
    return React.createElement(
      ReactNative.TouchableOpacity,
      {
        onPress,
        style: {
          backgroundColor: danger ? "#DA373C" : "#5865F2",
          paddingVertical: 11,
          paddingHorizontal: 14,
          borderRadius: 8,
          marginTop: 8,
          alignItems: "center",
        },
      },
      React.createElement(
        ReactNative.Text,
        { style: { color: "white", fontWeight: "700" } },
        label,
      ),
    );
  }

  function Field({ title, value, onChangeText, description, keyboardType }) {
    return React.createElement(ReactNative.View, { style: { marginBottom: 18 } }, [
      React.createElement(
        ReactNative.Text,
        { key: "title", style: { color: "white", fontSize: 15, fontWeight: "700", marginBottom: 6 } },
        title,
      ),
      React.createElement(ReactNative.TextInput, {
        key: "input",
        value,
        onChangeText,
        keyboardType: keyboardType || "default",
        placeholderTextColor: "#8A8D93",
        autoCapitalize: "none",
        autoCorrect: false,
        style: {
          backgroundColor: "#1E1F22",
          color: "white",
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 8,
          fontSize: 14,
        },
      }),
      React.createElement(
        ReactNative.Text,
        { key: "desc", style: { color: "#B5BAC1", fontSize: 12, marginTop: 6 } },
        description,
      ),
    ]);
  }

  function Toggle({ title, description, value, onValueChange }) {
    return React.createElement(
      ReactNative.View,
      {
        style: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 10,
          marginBottom: 8,
        },
      },
      [
        React.createElement(ReactNative.View, { key: "text", style: { flex: 1, paddingRight: 12 } }, [
          React.createElement(
            ReactNative.Text,
            { key: "title", style: { color: "white", fontSize: 15, fontWeight: "600" } },
            title,
          ),
          React.createElement(
            ReactNative.Text,
            { key: "desc", style: { color: "#B5BAC1", fontSize: 12, marginTop: 3 } },
            description,
          ),
        ]),
        React.createElement(ReactNative.Switch, { key: "switch", value: !!value, onValueChange }),
      ],
    );
  }

  function Settings() {
    useProxy(storage);

    const setCurrentChannel = (key) => {
      const current = getCurrentChannelId();
      if (!current) {
        try { showToast("Abra um canal primeiro.", 1); } catch {}
        return;
      }
      storage[key] = current;
      try { showToast("Canal salvo.", 0); } catch {}
    };

    const statusOk = !!RestApi?.get && (!!RestApi?.post || !!MessageActions?.sendMessage);

    return React.createElement(
      ReactNative.ScrollView,
      { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 60 } },
      [
        React.createElement(
          ReactNative.Text,
          { key: "header", style: { color: "white", fontSize: 22, fontWeight: "800", marginBottom: 8 } },
          "Channel Forwarder",
        ),
        React.createElement(
          ReactNative.Text,
          { key: "status", style: { color: statusOk ? "#23A55A" : "#DA373C", fontSize: 13, marginBottom: 18 } },
          statusOk ? "Status: Pronto" : "Status: módulos do Discord não encontrados",
        ),
        React.createElement(Field, {
          key: "source",
          title: "Canal de origem",
          value: String(storage.sourceChannelId || ""),
          onChangeText: (v) => (storage.sourceChannelId = cleanChannelId(v)),
          description: `Atual: ${getChannelLabel(storage.sourceChannelId)}`,
        }),
        React.createElement(ActionButton, {
          key: "source-current",
          label: "Usar canal aberto como origem",
          onPress: () => setCurrentChannel("sourceChannelId"),
        }),
        React.createElement(ReactNative.View, { key: "gap1", style: { height: 18 } }),
        React.createElement(Field, {
          key: "destination",
          title: "Canal de destino",
          value: String(storage.destinationChannelId || ""),
          onChangeText: (v) => (storage.destinationChannelId = cleanChannelId(v)),
          description: `Atual: ${getChannelLabel(storage.destinationChannelId)}`,
        }),
        React.createElement(ActionButton, {
          key: "destination-current",
          label: "Usar canal aberto como destino",
          onPress: () => setCurrentChannel("destinationChannelId"),
        }),
        React.createElement(ReactNative.View, { key: "gap2", style: { height: 24 } }),
        React.createElement(
          ReactNative.Text,
          { key: "hist-title", style: { color: "white", fontSize: 17, fontWeight: "800", marginBottom: 8 } },
          "Mensagens já existentes",
        ),
        React.createElement(
          ReactNative.Text,
          { key: "hist-desc", style: { color: "#B5BAC1", fontSize: 12, lineHeight: 18, marginBottom: 8 } },
          "Busca todo o histórico disponível e encaminha nativamente, do mais antigo para o mais novo. Executar novamente pode duplicar mensagens.",
        ),
        React.createElement(Field, {
          key: "delay",
          title: "Intervalo entre encaminhamentos (ms)",
          value: String(storage.historyDelayMs || 700),
          keyboardType: "numeric",
          onChangeText: (v) => {
            const n = Number(String(v).replace(/\D/g, ""));
            storage.historyDelayMs = Number.isFinite(n) ? Math.max(350, n) : 700;
          },
          description: "Mínimo: 350 ms. Aumente se o Discord limitar os envios.",
        }),
        React.createElement(ActionButton, {
          key: "sync",
          label: "Encaminhar todo o histórico",
          onPress: syncHistory,
        }),
        React.createElement(ActionButton, {
          key: "stop",
          label: "Parar sincronização",
          danger: true,
          onPress: stopHistory,
        }),
        React.createElement(
          ReactNative.Text,
          { key: "progress", style: { color: "#B5BAC1", fontSize: 12, marginTop: 12, lineHeight: 18 } },
          String(storage.historyStatus || "Aguardando."),
        ),
        React.createElement(ReactNative.View, { key: "gap3", style: { height: 24 } }),
        React.createElement(Toggle, {
          key: "enabled",
          title: "Plugin ativo",
          description: "Liga ou desliga o encaminhamento automático de mensagens novas.",
          value: storage.enabled,
          onValueChange: (v) => (storage.enabled = v),
        }),
        React.createElement(Toggle, {
          key: "forward-new",
          title: "Encaminhar mensagens novas",
          description: "Depois do histórico, continua encaminhando novas mensagens automaticamente.",
          value: storage.forwardNew,
          onValueChange: (v) => (storage.forwardNew = v),
        }),
      ],
    );
  }

  plugin.onLoad = function () {
    startListener();
    try { showToast("Channel Forwarder carregado.", 0); } catch {}
    console.log("[Channel Forwarder] Plugin carregado.");
  };

  plugin.onUnload = function () {
    cancelHistory = true;
    stopListener();
    seenMessageIds.clear();
    console.log("[Channel Forwarder] Plugin descarregado.");
  };

  plugin.settings = Settings;
  return plugin;
})({}, vendetta.plugin, vendetta.metro, vendetta.metro.common, vendetta.storage, vendetta.ui.toasts);
