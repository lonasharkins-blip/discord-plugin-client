(function (plugin, pluginApi, metro, common, storageApi, toasts) {
  "use strict";

  const { storage } = pluginApi;
  const { findByProps, findByStoreName } = metro;
  const { React, ReactNative } = common;
  const { useProxy } = storageApi;
  const { showToast } = toasts;

  const FluxDispatcher = findByProps("dispatch", "subscribe");
  const MessageActions = findByProps("sendMessage", "editMessage");
  const SelectedChannelStore = findByStoreName("SelectedChannelStore");
  const ChannelStore = findByStoreName("ChannelStore");
  const GuildStore = findByStoreName("GuildStore");

  if (storage.enabled === undefined) storage.enabled = true;
  if (storage.sourceChannelId === undefined) storage.sourceChannelId = "";
  if (storage.destinationChannelId === undefined) storage.destinationChannelId = "";
  if (storage.nativeForward === undefined) storage.nativeForward = true;
  if (storage.fallbackCopy === undefined) storage.fallbackCopy = true;

  let running = false;
  let sendQueue = Promise.resolve();
  const seenMessageIds = new Set();

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

  function rememberMessage(id) {
    if (!id || seenMessageIds.has(id)) return false;
    seenMessageIds.add(id);
    if (seenMessageIds.size > 500) {
      const oldest = seenMessageIds.values().next().value;
      if (oldest) seenMessageIds.delete(oldest);
    }
    return true;
  }

  function neutralizeMentions(text) {
    return String(text ?? "").replace(/@/g, "@\u200b");
  }

  function splitMessage(text, maxLength = 1900) {
    const value = String(text ?? "");
    if (value.length <= maxLength) return [value];
    const chunks = [];
    let rest = value;
    while (rest.length > maxLength) {
      let cut = rest.lastIndexOf("\n", maxLength);
      if (cut < Math.floor(maxLength * 0.5)) cut = maxLength;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, "");
    }
    if (rest) chunks.push(rest);
    return chunks;
  }

  async function sendNativeForward(message, destinationChannelId) {
    if (!MessageActions?.sendMessage) return false;

    const camelReference = {
      type: 1,
      messageId: message.id,
      channelId: message.channel_id,
    };
    if (message.guild_id) camelReference.guildId = message.guild_id;

    try {
      await Promise.resolve(
        MessageActions.sendMessage(destinationChannelId, {
          content: "",
          messageReference: camelReference,
        }),
      );
      return true;
    } catch {}

    const apiReference = {
      type: 1,
      message_id: message.id,
      channel_id: message.channel_id,
    };
    if (message.guild_id) apiReference.guild_id = message.guild_id;

    try {
      await Promise.resolve(
        MessageActions.sendMessage(destinationChannelId, {
          content: "",
          message_reference: apiReference,
        }),
      );
      return true;
    } catch {}

    return false;
  }

  async function sendFallbackCopy(message, destinationChannelId) {
    if (!MessageActions?.sendMessage) return false;

    const author =
      message?.author?.global_name ||
      message?.author?.username ||
      message?.author?.displayName ||
      "Usuário";

    const lines = [`**${neutralizeMentions(author)}**`];
    if (message?.content) lines.push(neutralizeMentions(message.content));

    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    for (const attachment of attachments) {
      const url = attachment?.url || attachment?.proxy_url;
      if (url) lines.push(url);
    }

    if (!message?.content && attachments.length === 0) {
      lines.push("*(mensagem sem texto; o Forward nativo não pôde ser usado)*");
    }

    for (const chunk of splitMessage(lines.join("\n"))) {
      await Promise.resolve(MessageActions.sendMessage(destinationChannelId, { content: chunk }));
    }
    return true;
  }

  async function forwardMessage(message) {
    const sourceChannelId = cleanChannelId(storage.sourceChannelId);
    const destinationChannelId = cleanChannelId(storage.destinationChannelId);

    if (!storage.enabled || !sourceChannelId || !destinationChannelId) return;
    if (!message?.id || message.channel_id !== sourceChannelId) return;
    if (sourceChannelId === destinationChannelId) return;
    if (!rememberMessage(message.id)) return;

    if (storage.nativeForward) {
      const ok = await sendNativeForward(message, destinationChannelId);
      if (ok) return;
    }

    if (storage.fallbackCopy) {
      await sendFallbackCopy(message, destinationChannelId);
    }
  }

  function onMessageCreate(action) {
    const message = action?.message;
    if (!message) return;
    sendQueue = sendQueue
      .then(() => forwardMessage(message))
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

  function ActionButton({ label, onPress }) {
    return React.createElement(
      ReactNative.TouchableOpacity,
      {
        onPress,
        style: {
          backgroundColor: "#5865F2",
          paddingVertical: 11,
          paddingHorizontal: 14,
          borderRadius: 8,
          marginTop: 8,
          alignItems: "center",
        },
      },
      React.createElement(ReactNative.Text, { style: { color: "white", fontWeight: "700" } }, label),
    );
  }

  function Field({ title, value, onChangeText, description }) {
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
        placeholder: "Cole o ID ou link do canal",
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
      const current = SelectedChannelStore?.getChannelId?.();
      if (!current) {
        try { showToast("Abra um canal primeiro.", 1); } catch {}
        return;
      }
      storage[key] = current;
      try { showToast("Canal salvo.", 0); } catch {}
    };

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
          { key: "intro", style: { color: "#B5BAC1", fontSize: 13, marginBottom: 20, lineHeight: 18 } },
          "Encaminha novas mensagens recebidas no canal de origem para o canal de destino enquanto o Discord/Kettu estiver aberto.",
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
        React.createElement(ReactNative.View, { key: "gap2", style: { height: 20 } }),
        React.createElement(Toggle, {
          key: "enabled",
          title: "Encaminhamento ativo",
          description: "Liga ou desliga sem remover o plugin.",
          value: storage.enabled,
          onValueChange: (v) => (storage.enabled = v),
        }),
        React.createElement(Toggle, {
          key: "native",
          title: "Usar encaminhamento nativo",
          description: "Tenta usar o Forward do Discord para preservar a mensagem.",
          value: storage.nativeForward,
          onValueChange: (v) => (storage.nativeForward = v),
        }),
        React.createElement(Toggle, {
          key: "fallback",
          title: "Cópia de segurança",
          description: "Se o Forward falhar, envia texto + links dos anexos.",
          value: storage.fallbackCopy,
          onValueChange: (v) => (storage.fallbackCopy = v),
        }),
      ],
    );
  }

  plugin.onLoad = function () {
    startListener();
    console.log("[Channel Forwarder] Plugin carregado.");
  };

  plugin.onUnload = function () {
    stopListener();
    seenMessageIds.clear();
    console.log("[Channel Forwarder] Plugin descarregado.");
  };

  plugin.settings = Settings;
  return plugin;
})({}, vendetta.plugin, vendetta.metro, vendetta.metro.common, vendetta.storage, vendetta.ui.toasts);
