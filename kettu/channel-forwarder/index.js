(function () {
  "use strict";

  const { storage } = vendetta.plugin;
  const { React, ReactNative, FluxDispatcher } = vendetta.metro.common;
  const { findByProps, findByStoreName } = vendetta.metro;
  const { useProxy } = vendetta.storage;
  const { showToast } = vendetta.ui.toasts;

  const MessageActions =
    findByProps("sendMessage", "receiveMessage") ||
    findByProps("sendMessage", "editMessage") ||
    findByProps("sendMessage");

  const SelectedChannelStore = findByStoreName("SelectedChannelStore");
  const ChannelStore = findByStoreName("ChannelStore");
  const GuildStore = findByStoreName("GuildStore");

  if (storage.enabled === undefined) storage.enabled = true;
  if (storage.sourceChannelId === undefined) storage.sourceChannelId = "";
  if (storage.destinationChannelId === undefined) storage.destinationChannelId = "";
  if (storage.nativeForward === undefined) storage.nativeForward = false;

  let subscribed = false;
  let queue = Promise.resolve();
  const seen = new Set();

  function cleanId(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const fromLink = text.match(/discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d{15,25})/i);
    if (fromLink) return fromLink[1];
    const id = text.match(/\d{15,25}/);
    return id ? id[0] : "";
  }

  function channelLabel(id) {
    if (!id) return "Não definido";
    try {
      const channel = ChannelStore?.getChannel?.(id);
      if (!channel) return id;
      const guild = channel.guild_id ? GuildStore?.getGuild?.(channel.guild_id) : null;
      const name = channel.name ? `#${channel.name}` : id;
      return guild?.name ? `${guild.name} • ${name}` : name;
    } catch {
      return id;
    }
  }

  function remember(id) {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 1000) {
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }
    return true;
  }

  function neutralize(text) {
    return String(text ?? "").replace(/@/g, "@\u200b");
  }

  function chunks(text, max = 1900) {
    const value = String(text ?? "");
    if (value.length <= max) return [value];
    const out = [];
    let rest = value;
    while (rest.length > max) {
      let cut = rest.lastIndexOf("\n", max);
      if (cut < max * 0.5) cut = max;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, "");
    }
    if (rest) out.push(rest);
    return out;
  }

  async function sendText(channelId, content) {
    if (!MessageActions?.sendMessage) throw new Error("Módulo sendMessage não encontrado");
    return await Promise.resolve(
      MessageActions.sendMessage(channelId, {
        content,
        invalidEmojis: [],
        tts: false,
      }),
    );
  }

  async function tryNativeForward(message, destination) {
    if (!storage.nativeForward || !MessageActions?.sendMessage) return false;

    const refs = [
      {
        content: "",
        messageReference: {
          type: 1,
          messageId: message.id,
          channelId: message.channel_id,
          guildId: message.guild_id,
        },
      },
      {
        content: "",
        message_reference: {
          type: 1,
          message_id: message.id,
          channel_id: message.channel_id,
          guild_id: message.guild_id,
        },
      },
    ];

    for (const payload of refs) {
      try {
        await Promise.resolve(MessageActions.sendMessage(destination, payload));
        return true;
      } catch {}
    }
    return false;
  }

  async function copyMessage(message, destination) {
    const author =
      message?.author?.global_name ||
      message?.author?.username ||
      message?.author?.displayName ||
      "Usuário";

    const lines = [`**${neutralize(author)}**`];
    if (message?.content) lines.push(neutralize(message.content));

    for (const attachment of message?.attachments || []) {
      const url = attachment?.url || attachment?.proxy_url;
      if (url) lines.push(url);
    }

    for (const embed of message?.embeds || []) {
      const url = embed?.url || embed?.image?.url || embed?.video?.url;
      if (url && !lines.includes(url)) lines.push(url);
    }

    if (!message?.content && lines.length === 1) {
      lines.push("*(mensagem sem texto)*");
    }

    for (const part of chunks(lines.join("\n"))) {
      await sendText(destination, part);
    }
  }

  async function forward(message) {
    const source = cleanId(storage.sourceChannelId);
    const destination = cleanId(storage.destinationChannelId);

    if (!storage.enabled || !source || !destination) return;
    if (!message?.id || message.channel_id !== source) return;
    if (source === destination || !remember(message.id)) return;

    if (await tryNativeForward(message, destination)) return;
    await copyMessage(message, destination);
  }

  function onMessageCreate(action) {
    const message = action?.message;
    if (!message) return;
    queue = queue
      .then(() => forward(message))
      .catch((error) => console.error("[Channel Forwarder]", error));
  }

  function subscribe() {
    if (subscribed || !FluxDispatcher?.subscribe) return;
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
    subscribed = true;
  }

  function unsubscribe() {
    if (!subscribed || !FluxDispatcher?.unsubscribe) return;
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
    subscribed = false;
  }

  function Text({ children, style }) {
    return React.createElement(ReactNative.Text, { style }, children);
  }

  function Button({ label, onPress }) {
    return React.createElement(
      ReactNative.TouchableOpacity,
      {
        onPress,
        style: {
          backgroundColor: "#5865F2",
          borderRadius: 8,
          paddingVertical: 12,
          paddingHorizontal: 14,
          alignItems: "center",
          marginTop: 8,
        },
      },
      React.createElement(Text, { style: { color: "white", fontWeight: "700" } }, label),
    );
  }

  function Field({ title, value, onChangeText, subtitle }) {
    return React.createElement(ReactNative.View, { style: { marginBottom: 16 } }, [
      React.createElement(Text, { key: "t", style: { color: "white", fontSize: 15, fontWeight: "700", marginBottom: 6 } }, title),
      React.createElement(ReactNative.TextInput, {
        key: "i",
        value,
        onChangeText,
        placeholder: "ID ou link do canal",
        placeholderTextColor: "#8A8D93",
        autoCapitalize: "none",
        autoCorrect: false,
        style: {
          backgroundColor: "#1E1F22",
          color: "white",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
        },
      }),
      React.createElement(Text, { key: "s", style: { color: "#B5BAC1", fontSize: 12, marginTop: 5 } }, subtitle),
    ]);
  }

  function Toggle({ title, subtitle, value, onValueChange }) {
    return React.createElement(
      ReactNative.View,
      { style: { flexDirection: "row", alignItems: "center", paddingVertical: 10 } },
      [
        React.createElement(ReactNative.View, { key: "txt", style: { flex: 1, paddingRight: 12 } }, [
          React.createElement(Text, { key: "t", style: { color: "white", fontSize: 15, fontWeight: "600" } }, title),
          React.createElement(Text, { key: "s", style: { color: "#B5BAC1", fontSize: 12, marginTop: 3 } }, subtitle),
        ]),
        React.createElement(ReactNative.Switch, { key: "sw", value: !!value, onValueChange }),
      ],
    );
  }

  function Settings() {
    useProxy(storage);

    function useCurrent(key) {
      const id = SelectedChannelStore?.getChannelId?.();
      if (!id) {
        showToast("Abra um canal primeiro.");
        return;
      }
      storage[key] = id;
      showToast("Canal salvo.");
    }

    const status = MessageActions?.sendMessage && FluxDispatcher?.subscribe ? "Pronto" : "Módulo do Discord indisponível";

    return React.createElement(
      ReactNative.ScrollView,
      { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 60 } },
      [
        React.createElement(Text, { key: "h", style: { color: "white", fontSize: 22, fontWeight: "800", marginBottom: 6 } }, "Channel Forwarder"),
        React.createElement(Text, { key: "st", style: { color: status === "Pronto" ? "#23A55A" : "#F23F42", marginBottom: 16 } }, `Status: ${status}`),

        React.createElement(Field, {
          key: "src",
          title: "Canal de origem",
          value: String(storage.sourceChannelId || ""),
          onChangeText: (v) => (storage.sourceChannelId = cleanId(v)),
          subtitle: channelLabel(storage.sourceChannelId),
        }),
        React.createElement(Button, { key: "srcbtn", label: "Usar canal aberto como origem", onPress: () => useCurrent("sourceChannelId") }),
        React.createElement(ReactNative.View, { key: "g1", style: { height: 20 } }),

        React.createElement(Field, {
          key: "dst",
          title: "Canal de destino",
          value: String(storage.destinationChannelId || ""),
          onChangeText: (v) => (storage.destinationChannelId = cleanId(v)),
          subtitle: channelLabel(storage.destinationChannelId),
        }),
        React.createElement(Button, { key: "dstbtn", label: "Usar canal aberto como destino", onPress: () => useCurrent("destinationChannelId") }),
        React.createElement(ReactNative.View, { key: "g2", style: { height: 20 } }),

        React.createElement(Toggle, {
          key: "on",
          title: "Encaminhamento ativo",
          subtitle: "Copia automaticamente novas mensagens da origem para o destino.",
          value: storage.enabled,
          onValueChange: (v) => (storage.enabled = v),
        }),
        React.createElement(Toggle, {
          key: "native",
          title: "Tentar Forward nativo",
          subtitle: "Desligado por padrão. Se falhar, a mensagem é copiada normalmente.",
          value: storage.nativeForward,
          onValueChange: (v) => (storage.nativeForward = v),
        }),
      ],
    );
  }

  return {
    onLoad() {
      subscribe();
      showToast("Channel Forwarder carregado.");
      console.log("[Channel Forwarder] carregado");
    },
    onUnload() {
      unsubscribe();
      seen.clear();
      console.log("[Channel Forwarder] descarregado");
    },
    settings: Settings,
  };
})()
