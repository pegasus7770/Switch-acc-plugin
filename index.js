(() => {
  const unpatches = [];
  let activeModalTriggers = new Set();
  let memAccounts = [];
  const STORAGE_KEY = "PEGASUS_ACCOUNTS_VAULT_V24";

  const getV = () => window.vendetta || window.bunny || window.revenge || {};

  // Read & Write using Bunny/Revenge native MMKV + Plugin Storage + AsyncStorage
  const getStorageBackends = () => {
    const v = getV();
    const backends = [];
    try {
      if (v.plugin?.storage) backends.push({ type: "plugin", ref: v.plugin.storage });
    } catch {}
    try {
      const mmkv = v.metro?.findByProps?.("getString", "set", "delete");
      if (mmkv?.getString && mmkv?.set) backends.push({ type: "mmkv", ref: mmkv });
    } catch {}
    try {
      const asyncSt =
        v.metro?.common?.ReactNative?.AsyncStorage ||
        v.metro?.findByProps?.("getItem", "setItem", "multiGet");
      if (asyncSt?.getItem && asyncSt?.setItem) backends.push({ type: "async", ref: asyncSt });
    } catch {}
    return backends;
  };

  const loadVault = async () => {
    let best = [...memAccounts];
    const backends = getStorageBackends();

    for (const b of backends) {
      try {
        if (b.type === "plugin" && Array.isArray(b.ref.accounts) && b.ref.accounts.length >= best.length) {
          best = JSON.parse(JSON.stringify(b.ref.accounts));
        } else if (b.type === "mmkv") {
          const raw = b.ref.getString(STORAGE_KEY);
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > best.length) best = arr;
          }
        } else if (b.type === "async") {
          const raw = await b.ref.getItem(STORAGE_KEY);
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > best.length) best = arr;
          }
        }
      } catch {}
    }

    memAccounts = best;
    return memAccounts;
  };

  const saveVault = async (list) => {
    const clean = JSON.parse(JSON.stringify(Array.isArray(list) ? list : []));
    memAccounts = clean;
    const raw = JSON.stringify(clean);
    const backends = getStorageBackends();

    for (const b of backends) {
      try {
        if (b.type === "plugin") {
          b.ref.accounts = clean;
        } else if (b.type === "mmkv") {
          b.ref.set(STORAGE_KEY, raw);
        } else if (b.type === "async") {
          await b.ref.setItem(STORAGE_KEY, raw);
        }
      } catch {}
    }
    return memAccounts;
  };

  const copyText = (txt, label) => {
    const v = getV();
    try {
      v.metro?.common?.clipboard?.setString?.(String(txt));
      v.ui?.toasts?.showToast?.(`Copied ${label}`);
    } catch {}
  };

  const getAvatarUrl = (userObj) => {
    if (!userObj?.id || String(userObj.id).startsWith("tok_")) {
      return "https://cdn.discordapp.com/embed/avatars/0.png";
    }
    if (userObj.avatar) {
      const ext = String(userObj.avatar).startsWith("a_") ? "gif" : "png";
      return `https://cdn.discordapp.com/avatars/${userObj.id}/${userObj.avatar}.${ext}?size=128`;
    }
    try {
      const idx = Number(BigInt(userObj.id) >> 22n) % 6;
      return `https://cdn.discordapp.com/embed/avatars/${isNaN(idx) ? 0 : idx}.png`;
    } catch {
      return "https://cdn.discordapp.com/embed/avatars/0.png";
    }
  };

  const getCurrentToken = () => {
    const v = getV();
    try {
      const t1 = v.metro?.findByStoreName?.("AuthenticationStore")?.getToken?.();
      if (t1 && typeof t1 === "string" && t1.length > 20) return t1;
    } catch {}
    try {
      const t2 = v.metro?.findByProps?.("getToken", "setToken")?.getToken?.();
      if (t2 && typeof t2 === "string" && t2.length > 20) return t2;
    } catch {}
    try {
      const t3 = v.metro?.findByProps?.("getToken", "removeToken")?.getToken?.();
      if (t3 && typeof t3 === "string" && t3.length > 20) return t3;
    } catch {}
    return null;
  };

  const getCurrentUser = () => {
    const v = getV();
    try {
      return v.metro?.findByStoreName?.("UserStore")?.getCurrentUser?.() || null;
    } catch {
      return null;
    }
  };

  const upsertAccount = async (entry) => {
    if (!entry || !entry.token) return memAccounts;
    await loadVault();
    const list = [...memAccounts];
    const cleanToken = String(entry.token).trim().replace(/^"|"$/g, "");
    const idx = list.findIndex(
      (a) => (entry.id && !String(entry.id).startsWith("tok_") && String(a.id) === String(entry.id)) || a.token === cleanToken
    );

    const record = {
      id: String(entry.id || `tok_${Date.now()}`),
      username: entry.username || "discord_user",
      globalName: entry.globalName || entry.username || "Saved Account",
      avatar: entry.avatar || null,
      token: cleanToken,
      updatedAt: Date.now()
    };

    if (idx >= 0) {
      if (cleanToken === "ACTIVE_SESSION" && list[idx].token && list[idx].token !== "ACTIVE_SESSION") {
        record.token = list[idx].token;
      }
      list[idx] = { ...list[idx], ...record };
    } else {
      list.push(record);
    }

    return await saveVault(list);
  };

  const syncCurrentAccount = async () => {
    await loadVault();
    const user = getCurrentUser();
    const token = getCurrentToken();
    if (user && token) {
      await upsertAccount({
        id: user.id,
        username: user.username,
        globalName: user.globalName || user.username,
        avatar: user.avatar || null,
        token
      });
    } else if (user && !memAccounts.some((a) => String(a.id) === String(user.id))) {
      await upsertAccount({
        id: user.id,
        username: user.username,
        globalName: user.globalName || user.username,
        avatar: user.avatar || null,
        token: "ACTIVE_SESSION"
      });
    }
    return memAccounts;
  };

  const resolveProfileFromToken = async (rawTok) => {
    const cleanToken = String(rawTok || "").trim().replace(/^"|"$/g, "");
    if (cleanToken.length < 20) {
      throw new Error("Token is too short.");
    }
    try {
      const res = await fetch("https://discord.com/api/v9/users/@me", {
        method: "GET",
        headers: {
          Authorization: cleanToken,
          "Content-Type": "application/json"
        }
      });
      if (res.ok) {
        const data = await res.json();
        return {
          id: data.id,
          username: data.username,
          globalName: data.global_name || data.username,
          avatar: data.avatar || null,
          token: cleanToken,
          valid: true
        };
      }
      if (res.status === 401) {
        throw new Error("Token expired or invalid (401). Copy a fresh token after logging in.");
      }
    } catch (e) {
      if (String(e?.message || "").includes("401")) throw e;
    }
    // Fallback if offline: still save the token so user never loses it
    return {
      id: `tok_${Date.now()}`,
      username: `token_${cleanToken.slice(0, 6)}`,
      globalName: "Saved Token Account",
      avatar: null,
      token: cleanToken,
      valid: false
    };
  };

  // Switch accounts silently WITHOUT calling AuthActions.logout() (which kills tokens via Native OkHttp!)
  const performSilentSwitch = async (targetAccount, onDone) => {
    const v = getV();
    if (!targetAccount?.token || targetAccount.token === "ACTIVE_SESSION") {
      v.ui?.toasts?.showToast?.("This account has no saved token yet.");
      return;
    }

    const targetToken = String(targetAccount.token).trim();
    try {
      await syncCurrentAccount();
      const verified = await resolveProfileFromToken(targetToken);
      await upsertAccount(verified);

      const AuthActions =
        v.metro?.findByProps?.("switchAccountToken") ||
        v.metro?.findByProps?.("loginToken");
      const TokenManager = v.metro?.findByProps?.("setToken", "getToken");
      const FluxDispatcher = v.metro?.common?.FluxDispatcher;

      if (AuthActions?.switchAccountToken) {
        await AuthActions.switchAccountToken(targetToken);
        v.ui?.toasts?.showToast?.(`Switched to ${verified.username}`);
        onDone?.();
        return;
      }

      if (AuthActions?.loginToken) {
        await AuthActions.loginToken(targetToken);
        v.ui?.toasts?.showToast?.(`Switched to ${verified.username}`);
        onDone?.();
        return;
      }

      if (TokenManager?.setToken) {
        TokenManager.setToken(targetToken);
        FluxDispatcher?.dispatch?.({
          type: "LOGIN_SUCCESS",
          token: targetToken
        });
        v.ui?.toasts?.showToast?.(`Switched to ${verified.username}`);
        onDone?.();
        return;
      }

      v.ui?.toasts?.showToast?.("Could not switch automatically. Token copied!");
      copyText(targetToken, verified.username);
    } catch (err) {
      v.ui?.toasts?.showToast?.(err?.message || "Switch failed");
    }
  };

  // Local-only session reset (NEVER calls AuthActions.logout so Discord servers NEVER invalidate the saved token!)
  const localOnlyResetToLogin = async (onCloseModal) => {
    const v = getV();
    try {
      await syncCurrentAccount();
      onCloseModal?.();

      const TokenManager =
        v.metro?.findByProps?.("removeToken", "setToken") ||
        v.metro?.findByProps?.("setToken", "getToken");
      if (TokenManager?.removeToken) {
        TokenManager.removeToken();
      } else if (TokenManager?.setToken) {
        TokenManager.setToken(null);
      }

      const FluxDispatcher = v.metro?.common?.FluxDispatcher;
      if (FluxDispatcher?.dispatch) {
        FluxDispatcher.dispatch({ type: "LOGOUT" });
      }
      v.ui?.toasts?.showToast?.("Previous token saved! Log in to your next account.");
    } catch {
      v.ui?.toasts?.showToast?.("Error opening login screen.");
    }
  };

  const setupLoginAutoCapture = () => {
    const v = getV();
    const FluxDispatcher = v.metro?.common?.FluxDispatcher;
    if (!FluxDispatcher?.subscribe) return;

    const onAuth = () => {
      setTimeout(async () => {
        try {
          const user = getCurrentUser();
          const token = getCurrentToken();
          if (user && token) {
            await syncCurrentAccount();
            v.ui?.toasts?.showToast?.(`Saved @${user.username} to Switcher!`);
          }
        } catch {}
      }, 2500);
    };

    try {
      FluxDispatcher.subscribe("CONNECTION_OPEN", onAuth);
      FluxDispatcher.subscribe("LOGIN_SUCCESS", onAuth);
      unpatches.push(() => {
        try {
          FluxDispatcher.unsubscribe("CONNECTION_OPEN", onAuth);
          FluxDispatcher.unsubscribe("LOGIN_SUCCESS", onAuth);
        } catch {}
      });
    } catch {}
  };

  function SwitcherScreen({ onClose }) {
    const v = getV();
    const React = v.metro?.common?.React;
    const RN = v.metro?.common?.ReactNative;
    if (!React || !RN) return null;

    const { ScrollView, View, Text, Pressable, TextInput, Image, SafeAreaView, StatusBar } = RN;
    const [accounts, setAccounts] = React.useState([...memAccounts]);
    const [showAdd, setShowAdd] = React.useState(false);
    const [rawToken, setRawToken] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [errorMsg, setErrorMsg] = React.useState("");

    const refreshList = async () => {
      const updated = await syncCurrentAccount();
      setAccounts([...updated]);
    };

    React.useEffect(() => {
      refreshList();
    }, []);

    const currentUser = getCurrentUser();
    const currentToken = getCurrentToken();

    const handleSaveToken = async () => {
      if (!rawToken.trim()) {
        setErrorMsg("Paste a Discord token first.");
        return;
      }
      setLoading(true);
      setErrorMsg("");
      try {
        const profile = await resolveProfileFromToken(rawToken);
        const updated = await upsertAccount(profile);
        setAccounts([...updated]);
        setRawToken("");
        setShowAdd(false);
        v.ui?.toasts?.showToast?.(`Saved @${profile.username}`);
      } catch (e) {
        setErrorMsg(e?.message || "Invalid token.");
      } finally {
        setLoading(false);
      }
    };

    const handleDelete = async (id) => {
      const next = accounts.filter((a) => String(a.id) !== String(id));
      await saveVault(next);
      setAccounts([...next]);
      v.ui?.toasts?.showToast?.("Account removed");
    };

    const Container = SafeAreaView || View;
    const topInset = (StatusBar?.currentHeight || 28) + 8;

    return React.createElement(
      Container,
      { style: { flex: 1, backgroundColor: "#111214" } },
      // Header
      React.createElement(
        View,
        {
          style: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 18,
            paddingTop: topInset,
            paddingBottom: 14,
            borderBottomWidth: 1,
            borderBottomColor: "#1E1F22"
          }
        },
        React.createElement(
          View,
          null,
          React.createElement(
            Text,
            { style: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" } },
            "Accounts"
          ),
          React.createElement(
            Text,
            { style: { color: "#949BA4", fontSize: 12, marginTop: 2 } },
            "Tap any account to switch • Copy saves your token"
          )
        ),
        onClose
          ? React.createElement(
              Pressable,
              {
                style: {
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: "#2B2D31",
                  alignItems: "center",
                  justifyContent: "center"
                },
                onPress: onClose
              },
              React.createElement(Text, { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" } }, "✕")
            )
          : null
      ),

      // Accounts List
      React.createElement(
        ScrollView,
        { style: { flex: 1, paddingHorizontal: 16, paddingTop: 14 } },
        accounts.map((acc) => {
          const isActive =
            String(currentUser?.id) === String(acc.id) ||
            (currentToken && currentToken === acc.token);
          return React.createElement(
            Pressable,
            {
              key: acc.id + acc.token.slice(0, 8),
              style: {
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: isActive ? "#1E242B" : "#1E1F22",
                borderRadius: 16,
                padding: 12,
                marginBottom: 10,
                borderWidth: isActive ? 1.5 : 0,
                borderColor: "#23A55A"
              },
              onPress: () => {
                if (!isActive) performSilentSwitch(acc, onClose);
              }
            },
            Image
              ? React.createElement(Image, {
                  source: { uri: getAvatarUrl(acc) },
                  style: {
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    backgroundColor: "#2B2D31"
                  }
                })
              : null,
            React.createElement(
              View,
              { style: { flex: 1, marginLeft: 12 } },
              React.createElement(
                View,
                { style: { flexDirection: "row", alignItems: "center" } },
                React.createElement(
                  Text,
                  { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" }, numberOfLines: 1 },
                  acc.globalName
                ),
                isActive
                  ? React.createElement(
                      View,
                      {
                        style: {
                          backgroundColor: "#23A55A",
                          borderRadius: 6,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          marginLeft: 8
                        }
                      },
                      React.createElement(Text, { style: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" } }, "ACTIVE")
                    )
                  : null
              ),
              React.createElement(
                Text,
                { style: { color: "#949BA4", fontSize: 13, marginTop: 2 } },
                `@${acc.username}`
              )
            ),
            acc.token && acc.token !== "ACTIVE_SESSION"
              ? React.createElement(
                  Pressable,
                  {
                    style: {
                      backgroundColor: "#2B2D31",
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 10,
                      marginLeft: 8
                    },
                    onPress: (e) => {
                      e?.stopPropagation?.();
                      copyText(acc.token, `${acc.username}'s Token`);
                    }
                  },
                  React.createElement(Text, { style: { color: "#DBDEE1", fontSize: 12, fontWeight: "600" } }, "Copy")
                )
              : null,
            !isActive
              ? React.createElement(
                  Pressable,
                  {
                    style: {
                      backgroundColor: "#2B2D31",
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderRadius: 10,
                      marginLeft: 6
                    },
                    onPress: (e) => {
                      e?.stopPropagation?.();
                      handleDelete(acc.id);
                    }
                  },
                  React.createElement(Text, { style: { color: "#F23F43", fontSize: 12, fontWeight: "700" } }, "✕")
                )
              : null
          );
        }),

        // Add Account Panel
        showAdd
          ? React.createElement(
              View,
              {
                style: {
                  backgroundColor: "#1E1F22",
                  borderRadius: 16,
                  padding: 16,
                  marginTop: 6,
                  marginBottom: 20
                }
              },
              React.createElement(
                Text,
                { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginBottom: 8 } },
                "Add Account by Token"
              ),
              errorMsg
                ? React.createElement(
                    Text,
                    { style: { color: "#F23F43", fontSize: 12, marginBottom: 10 } },
                    errorMsg
                  )
                : null,
              React.createElement(TextInput, {
                style: {
                  backgroundColor: "#111214",
                  color: "#FFFFFF",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 11,
                  marginBottom: 10
                },
                placeholder: "Paste Discord token here...",
                placeholderTextColor: "#72767D",
                value: rawToken,
                onChangeText: setRawToken,
                autoCapitalize: "none"
              }),
              React.createElement(
                Pressable,
                {
                  style: {
                    backgroundColor: "#23A55A",
                    borderRadius: 10,
                    paddingVertical: 12,
                    alignItems: "center",
                    marginBottom: 12
                  },
                  onPress: loading ? undefined : handleSaveToken
                },
                React.createElement(
                  Text,
                  { style: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 } },
                  loading ? "Saving..." : "Save Token"
                )
              ),
              React.createElement(
                Pressable,
                {
                  style: {
                    backgroundColor: "#2B2D31",
                    borderRadius: 10,
                    paddingVertical: 12,
                    alignItems: "center"
                  },
                  onPress: () => localOnlyResetToLogin(onClose)
                },
                React.createElement(
                  Text,
                  { style: { color: "#00A8FC", fontWeight: "700", fontSize: 13 } },
                  "Or Local Log Out -> Login Screen"
                )
              )
            )
          : null,

        React.createElement(View, { style: { height: 24 } })
      ),

      // Bottom "+ Add Account" Button
      React.createElement(
        View,
        {
          style: {
            padding: 16,
            borderTopWidth: 1,
            borderTopColor: "#1E1F22",
            backgroundColor: "#111214"
          }
        },
        React.createElement(
          Pressable,
          {
            style: {
              backgroundColor: showAdd ? "#2B2D31" : "#5865F2",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center"
            },
            onPress: () => {
              setErrorMsg("");
              setShowAdd(!showAdd);
            }
          },
          React.createElement(
            Text,
            { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" } },
            showAdd ? "Cancel" : "+ Add Account"
          )
        )
      )
    );
  }

  const mountFullScreenModalOverlay = () => {
    const v = getV();
    const React = v.metro?.common?.React;
    const RN = v.metro?.common?.ReactNative;
    const patcher = v.patcher;
    if (!React || !RN?.Modal || !patcher?.after) return;

    function SwitcherModalHost() {
      const [visible, setVisible] = React.useState(false);
      React.useEffect(() => {
        activeModalTriggers.add(setVisible);
        return () => {
          activeModalTriggers.delete(setVisible);
        };
      }, []);

      if (!visible) return null;
      return React.createElement(
        RN.Modal,
        {
          visible,
          animationType: "slide",
          transparent: false,
          onRequestClose: () => setVisible(false)
        },
        React.createElement(SwitcherScreen, { onClose: () => setVisible(false) })
      );
    }

    try {
      const unpatch = patcher.after("render", RN.View, (_, res) => {
        if (res?.props?.style?.flex === 1 && !res._hasSwitcherHost) {
          res._hasSwitcherHost = true;
          const origChildren = res.props.children;
          return React.cloneElement(
            res,
            {},
            origChildren,
            React.createElement(SwitcherModalHost, { key: "pegasus-switcher-modal-host-v24" })
          );
        }
        return res;
      });
      if (typeof unpatch === "function") unpatches.push(unpatch);
    } catch {}
  };

  const openFullScreenSwitcher = async () => {
    await syncCurrentAccount();
    const triggers = Array.from(activeModalTriggers);
    if (triggers.length > 0) {
      triggers[triggers.length - 1](true);
      return;
    }
    const v = getV();
    v.ui?.toasts?.showToast?.("Open Revenge > Plugins > AccountSwitcher gear icon");
  };

  const registerAllSettingsHooks = () => {
    const targets = [window.vendetta, window.bunny, window.revenge].filter(Boolean);
    for (const t of targets) {
      const s = t.ui?.settings;
      if (!s) continue;
      let iconAsset;
      try {
        iconAsset =
          t.ui?.assets?.getAssetIDByName?.("ic_account_circle_24px") ||
          t.ui?.assets?.getAssetIDByName?.("ic_person_24px") ||
          t.ui?.assets?.getAssetIDByName?.("ic_settings_24px");
      } catch {}

      if (typeof s.registerSection === "function") {
        try {
          const u = s.registerSection({
            name: "Account Switcher",
            items: [
              {
                key: "pegasus-switch-account-v24",
                title: () => "Switch Account",
                icon: iconAsset,
                render: SwitcherScreen,
                onPress: () => openFullScreenSwitcher(),
                usePredicate: () => true
              }
            ]
          });
          if (typeof u === "function") unpatches.push(u);
          break;
        } catch {}
      }
    }
  };

  const registerSlashCommand = () => {
    const v = getV();
    if (v.commands?.registerCommand) {
      try {
        const unreg = v.commands.registerCommand({
          name: "switch",
          displayName: "switch",
          description: "Open Account Switcher",
          displayDescription: "Open Account Switcher",
          options: [],
          applicationId: "-1",
          inputType: 1,
          type: 1,
          execute: () => openFullScreenSwitcher()
        });
        if (typeof unreg === "function") unpatches.push(unreg);
      } catch {}
    }
  };

  return {
    async onLoad() {
      try {
        await syncCurrentAccount();
        setupLoginAutoCapture();
        mountFullScreenModalOverlay();
        registerAllSettingsHooks();
        registerSlashCommand();
      } catch (e) {
        console.error("[AccountSwitcher] onLoad:", e);
      }
    },
    onUnload() {
      activeModalTriggers.clear();
      while (unpatches.length) {
        try {
          const fn = unpatches.pop();
          if (typeof fn === "function") fn();
        } catch {}
      }
    },
    settings: SwitcherScreen
  };
})();
