(() => {
  const unpatches = [];
  let activeModalTriggers = new Set();
  let memAccounts = [];
  const STORAGE_KEY = "PEGASUS_SWITCH_ACCOUNTS_V22";
  const FILE_NAME = "pegasus_switch_accounts_v22.json";

  const getV = () => window.vendetta || window.bunny || window.revenge || {};

  // Multi-layer persistent storage (Native Device File + AsyncStorage + MMKV + PluginStorage)
  const getNativeFS = () => {
    const v = getV();
    try {
      const nm = v.metro?.common?.ReactNative?.NativeModules || {};
      return (
        nm.DCDFileManager ||
        nm.RTNFileManager ||
        nm.FileManager ||
        v.metro?.findByProps?.("readFile", "writeFile", "DocumentsDirPath") ||
        v.metro?.findByProps?.("getConstants", "writeFile") ||
        null
      );
    } catch {
      return null;
    }
  };

  const getFilePath = (fs) => {
    if (!fs) return null;
    const c = fs.getConstants ? fs.getConstants() : fs;
    const dir = c?.DocumentsDirPath || c?.CacheDirPath || fs.DocumentsDirPath || fs.CacheDirPath;
    return dir ? `${dir}/${FILE_NAME}` : null;
  };

  const loadAccountsFromDisk = async () => {
    const v = getV();
    let best = [...memAccounts];

    try {
      const fs = getNativeFS();
      const path = getFilePath(fs);
      if (fs && path && fs.readFile) {
        const raw = await fs.readFile(path, "utf8");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length >= best.length) best = parsed;
        }
      }
    } catch {}

    try {
      const AsyncStorage =
        v.metro?.common?.ReactNative?.AsyncStorage ||
        v.metro?.findByProps?.("getItem", "setItem", "multiGet");
      if (AsyncStorage?.getItem) {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > best.length) best = parsed;
        }
      }
    } catch {}

    try {
      const kv = v.metro?.findByProps?.("getString", "set", "delete");
      if (kv?.getString) {
        const raw = kv.getString(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > best.length) best = parsed;
        }
      }
    } catch {}

    try {
      const pStore = v.plugin?.storage;
      if (pStore && Array.isArray(pStore.accounts) && pStore.accounts.length > best.length) {
        best = [...pStore.accounts];
      }
    } catch {}

    memAccounts = best;
    return memAccounts;
  };

  const persistAccountsToDisk = async (list) => {
    const v = getV();
    const clean = JSON.parse(JSON.stringify(Array.isArray(list) ? list : []));
    memAccounts = clean;
    const serialized = JSON.stringify(clean);

    try {
      const fs = getNativeFS();
      const path = getFilePath(fs);
      if (fs && path && fs.writeFile) {
        await fs.writeFile(path, serialized, "utf8");
      }
    } catch {}

    try {
      const AsyncStorage =
        v.metro?.common?.ReactNative?.AsyncStorage ||
        v.metro?.findByProps?.("getItem", "setItem", "multiGet");
      if (AsyncStorage?.setItem) {
        await AsyncStorage.setItem(STORAGE_KEY, serialized);
      }
    } catch {}

    try {
      const kv = v.metro?.findByProps?.("getString", "set", "delete");
      if (kv?.set) kv.set(STORAGE_KEY, serialized);
    } catch {}

    try {
      if (v.plugin) {
        if (!v.plugin.storage) v.plugin.storage = {};
        v.plugin.storage.accounts = clean;
      }
    } catch {}
  };

  const copyText = (txt, label) => {
    const v = getV();
    try {
      v.metro?.common?.clipboard?.setString?.(String(txt));
      v.ui?.toasts?.showToast?.(`Copied ${label}`);
    } catch {}
  };

  const getAvatarUrl = (userObj) => {
    if (!userObj?.id) return "https://cdn.discordapp.com/embed/avatars/0.png";
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

  const saveAccountEntry = async (entry) => {
    if (!entry || !entry.token) return memAccounts;
    await loadAccountsFromDisk();
    const list = [...memAccounts];
    const cleanToken = String(entry.token).trim();
    const idx = list.findIndex((a) => (entry.id && String(a.id) === String(entry.id)) || a.token === cleanToken);
    const cleanEntry = {
      id: String(entry.id || Date.now()),
      username: entry.username || "unknown",
      globalName: entry.globalName || entry.username || "Discord User",
      avatar: entry.avatar || null,
      token: cleanToken,
      addedAt: Date.now()
    };
    if (idx >= 0) {
      if (cleanToken === "ACTIVE_SESSION" && list[idx].token && list[idx].token !== "ACTIVE_SESSION") {
        cleanEntry.token = list[idx].token;
      }
      list[idx] = { ...list[idx], ...cleanEntry };
    } else {
      list.push(cleanEntry);
    }
    await persistAccountsToDisk(list);
    return list;
  };

  const syncCurrentAccount = async () => {
    await loadAccountsFromDisk();
    const user = getCurrentUser();
    const token = getCurrentToken();
    if (user && token) {
      await saveAccountEntry({
        id: user.id,
        username: user.username,
        globalName: user.globalName || user.username,
        avatar: user.avatar || null,
        token
      });
    } else if (user && !memAccounts.some((a) => String(a.id) === String(user.id))) {
      await saveAccountEntry({
        id: user.id,
        username: user.username,
        globalName: user.globalName || user.username,
        avatar: user.avatar || null,
        token: "ACTIVE_SESSION"
      });
    }
    return memAccounts;
  };

  const fetchUserByToken = async (token) => {
    const cleanToken = String(token || "").trim().replace(/^"|"$/g, "");
    const res = await fetch("https://discord.com/api/v9/users/@me", {
      method: "GET",
      headers: {
        Authorization: cleanToken,
        "Content-Type": "application/json"
      }
    });
    if (!res.ok) throw new Error(`Invalid token (HTTP ${res.status})`);
    const data = await res.json();
    return {
      id: data.id,
      username: data.username,
      globalName: data.global_name || data.username,
      avatar: data.avatar || null,
      token: cleanToken
    };
  };

  const performSilentSwitch = async (targetAccount, onDone) => {
    const v = getV();
    if (!targetAccount?.token || targetAccount.token === "ACTIVE_SESSION") {
      v.ui?.toasts?.showToast?.("Add this account's token first to switch back to it.");
      return;
    }

    const targetToken = String(targetAccount.token).trim();
    try {
      await syncCurrentAccount();
      const verified = await fetchUserByToken(targetToken);
      await saveAccountEntry(verified);

      const AuthActions =
        v.metro?.findByProps?.("switchAccountToken") ||
        v.metro?.findByProps?.("loginToken") ||
        v.metro?.findByProps?.("login", "logout");

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

      v.ui?.toasts?.showToast?.("Token verified! Copy Token if needed.");
    } catch (err) {
      v.ui?.toasts?.showToast?.(`Switch failed: ${err?.message || "Expired token"}`);
    }
  };

  // Embedded Discord WebView Login (keeps current account untouched + supports Captcha/2FA + auto-captures token!)
  function DiscordWebLoginView({ onTokenCaptured, onCancel }) {
    const v = getV();
    const React = v.metro?.common?.React;
    const RN = v.metro?.common?.ReactNative;
    if (!React || !RN) return null;

    const { View, Text, Pressable } = RN;
    const WebViewComp =
      RN.WebView ||
      v.metro?.findByProps?.("WebView")?.WebView ||
      v.metro?.findByName?.("WebView") ||
      v.metro?.findByName?.("RNCWebView");

    // JS injected into discord.com/login to automatically extract the token once login + captcha finishes
    const injectedTokenExtractor = `
      (function() {
        if (window.__pegasusTokenHooked) return;
        window.__pegasusTokenHooked = true;
        setInterval(function() {
          try {
            var iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            var raw = iframe.contentWindow.localStorage.getItem('token');
            iframe.remove();
            if (raw) {
              var clean = raw.replace(/^"|"$/g, '');
              if (clean.length > 20 && window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DISCORD_TOKEN', token: clean }));
              }
            }
          } catch (e) {}
        }, 1200);
      })();
      true;
    `;

    return React.createElement(
      View,
      { style: { flex: 1, backgroundColor: "#111214" } },
      React.createElement(
        View,
        {
          style: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: "#18191C",
            borderBottomWidth: 1,
            borderBottomColor: "#2B2D31"
          }
        },
        React.createElement(
          Text,
          { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" } },
          "Discord Login (Auto-Saves Token)"
        ),
        React.createElement(
          Pressable,
          {
            style: { backgroundColor: "#DA373C", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
            onPress: onCancel
          },
          React.createElement(Text, { style: { color: "#FFF", fontWeight: "700", fontSize: 12 } }, "Cancel")
        )
      ),
      WebViewComp
        ? React.createElement(WebViewComp, {
            source: { uri: "https://discord.com/login" },
            style: { flex: 1 },
            javaScriptEnabled: true,
            domStorageEnabled: true,
            incognito: true,
            injectedJavaScript: injectedTokenExtractor,
            onMessage: (event) => {
              try {
                const payload = JSON.parse(event?.nativeEvent?.data || "{}");
                if (payload.type === "DISCORD_TOKEN" && payload.token) {
                  onTokenCaptured(payload.token);
                }
              } catch {}
            }
          })
        : React.createElement(
            View,
            { style: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 } },
            React.createElement(
              Text,
              { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "700", textAlign: "center", marginBottom: 8 } },
              "WebView component unavailable in this client build."
            ),
            React.createElement(
              Text,
              { style: { color: "#949BA4", fontSize: 13, textAlign: "center" } },
              "Please go back and select 'By Token' to add your account."
            )
          )
    );
  }

  function SwitcherScreen({ onClose }) {
    const v = getV();
    const React = v.metro?.common?.React;
    const RN = v.metro?.common?.ReactNative;
    if (!React || !RN) return null;

    const { ScrollView, View, Text, Pressable, TextInput, Image, SafeAreaView, StatusBar } = RN;
    const [accounts, setAccounts] = React.useState([...memAccounts]);
    const [addStep, setAddStep] = React.useState("none"); // "none" | "choose" | "token" | "weblogin"
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

    const saveCapturedToken = async (tok) => {
      if (!tok || loading) return;
      setLoading(true);
      setErrorMsg("");
      try {
        const profile = await fetchUserByToken(tok);
        const updated = await saveAccountEntry(profile);
        setAccounts([...updated]);
        setRawToken("");
        setAddStep("none");
        v.ui?.toasts?.showToast?.(`Saved @${profile.username} automatically!`);
      } catch (e) {
        setErrorMsg(e?.message || "Invalid or expired token.");
      } finally {
        setLoading(false);
      }
    };

    const handleDelete = async (id) => {
      const next = accounts.filter((a) => String(a.id) !== String(id));
      await persistAccountsToDisk(next);
      setAccounts([...next]);
      v.ui?.toasts?.showToast?.("Account removed");
    };

    const Container = SafeAreaView || View;
    const topInset = (StatusBar?.currentHeight || 28) + 8;

    if (addStep === "weblogin") {
      return React.createElement(
        Container,
        { style: { flex: 1, backgroundColor: "#111214", paddingTop: topInset } },
        React.createElement(DiscordWebLoginView, {
          onTokenCaptured: (tok) => saveCapturedToken(tok),
          onCancel: () => setAddStep("choose")
        })
      );
    }

    return React.createElement(
      Container,
      { style: { flex: 1, backgroundColor: "#111214" } },
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
            "Tap any account to switch instantly"
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

      React.createElement(
        ScrollView,
        { style: { flex: 1, paddingHorizontal: 16, paddingTop: 14 } },
        accounts.length === 0
          ? React.createElement(
              View,
              {
                style: {
                  backgroundColor: "#1E1F22",
                  borderRadius: 16,
                  padding: 24,
                  alignItems: "center",
                  marginTop: 20
                }
              },
              React.createElement(
                Text,
                { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" } },
                "No saved accounts"
              ),
              React.createElement(
                Text,
                { style: { color: "#949BA4", fontSize: 13, marginTop: 6, textAlign: "center" } },
                "Tap '+ Add Account' below to add via Login or Token."
              )
            )
          : accounts.map((acc) => {
              const isActive =
                String(currentUser?.id) === String(acc.id) ||
                (currentToken && currentToken === acc.token);
              return React.createElement(
                Pressable,
                {
                  key: acc.id,
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

        // Step 1: Ask User -> By Token OR Discord Login
        addStep === "choose"
          ? React.createElement(
              View,
              {
                style: {
                  backgroundColor: "#1E1F22",
                  borderRadius: 16,
                  padding: 16,
                  marginTop: 8,
                  marginBottom: 20
                }
              },
              React.createElement(
                Text,
                { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginBottom: 4 } },
                "Add Account Method"
              ),
              React.createElement(
                Text,
                { style: { color: "#949BA4", fontSize: 12, marginBottom: 14 } },
                "Your current session stays active and saved."
              ),
              React.createElement(
                Pressable,
                {
                  style: {
                    backgroundColor: "#5865F2",
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 10
                  },
                  onPress: () => setAddStep("weblogin")
                },
                React.createElement(
                  Text,
                  { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" } },
                  "Discord Login (Captcha & 2FA Supported)"
                ),
                React.createElement(
                  Text,
                  { style: { color: "#E0E3FF", fontSize: 12, marginTop: 3 } },
                  "Log in normally in Discord Web, solves captcha, and saves automatically."
                )
              ),
              React.createElement(
                Pressable,
                {
                  style: {
                    backgroundColor: "#2B2D31",
                    borderRadius: 12,
                    padding: 14
                  },
                  onPress: () => {
                    setErrorMsg("");
                    setAddStep("token");
                  }
                },
                React.createElement(
                  Text,
                  { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" } },
                  "By Token"
                ),
                React.createElement(
                  Text,
                  { style: { color: "#949BA4", fontSize: 12, marginTop: 3 } },
                  "Paste an account token directly."
                )
              )
            )
          : null,

        // Step 2: By Token Input
        addStep === "token"
          ? React.createElement(
              View,
              {
                style: {
                  backgroundColor: "#1E1F22",
                  borderRadius: 16,
                  padding: 16,
                  marginTop: 8,
                  marginBottom: 20
                }
              },
              React.createElement(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
                React.createElement(
                  Text,
                  { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" } },
                  "Add Account by Token"
                ),
                React.createElement(
                  Pressable,
                  { onPress: () => setAddStep("choose") },
                  React.createElement(Text, { style: { color: "#00A8FC", fontSize: 13, fontWeight: "600" } }, "← Back")
                )
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
                    alignItems: "center"
                  },
                  onPress: loading ? undefined : () => saveCapturedToken(rawToken)
                },
                React.createElement(
                  Text,
                  { style: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 } },
                  loading ? "Saving..." : "Save Account"
                )
              )
            )
          : null,

        React.createElement(View, { style: { height: 24 } })
      ),

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
              backgroundColor: addStep !== "none" ? "#2B2D31" : "#5865F2",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center"
            },
            onPress: () => {
              setErrorMsg("");
              setAddStep(addStep !== "none" ? "none" : "choose");
            }
          },
          React.createElement(
            Text,
            { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" } },
            addStep !== "none" ? "Cancel" : "+ Add Account"
          )
        )
      )
    );
  }

  // Exact v17 modal overlay mechanism with mounted-set tracking so Switch Account button ALWAYS triggers
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
            React.createElement(SwitcherModalHost, { key: "pegasus-switcher-modal-host-v22" })
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
      const lastTrigger = triggers[triggers.length - 1];
      lastTrigger(true);
      return;
    }
    const v = getV();
    v.ui?.toasts?.showToast?.("Reload Discord once to activate Switcher");
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
                key: "pegasus-switch-account-v22",
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
