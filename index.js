(() => {
  const unpatches = [];
  let setGlobalModalOpen = null;
  let memAccounts = [];
  const STORAGE_KEY = "PEGASUS_SWITCH_ACCOUNTS_V17";

  const getV = () => window.vendetta || window.bunny || window.revenge || {};

  // Multi-layer persistent storage (Plugin Storage + ReactNative AsyncStorage + Memory)
  const loadAccountsFromDisk = async () => {
    const v = getV();
    let loaded = [];

    // 1. Try Plugin storage
    try {
      const pStore = v.plugin?.storage;
      if (pStore && Array.isArray(pStore.accounts) && pStore.accounts.length > 0) {
        loaded = [...pStore.accounts];
      }
    } catch {}

    // 2. Try ReactNative AsyncStorage (survives reloads & updates)
    try {
      const AsyncStorage =
        v.metro?.common?.ReactNative?.AsyncStorage ||
        v.metro?.findByProps?.("getItem", "setItem", "multiGet");
      if (AsyncStorage?.getItem) {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > loaded.length) {
            loaded = parsed;
          }
        }
      }
    } catch {}

    if (loaded.length > 0) {
      memAccounts = loaded;
    }
    return memAccounts;
  };

  const persistAccountsToDisk = async (list) => {
    const v = getV();
    const clean = Array.isArray(list) ? list : [];
    memAccounts = clean;

    // 1. Save to Plugin storage
    try {
      if (v.plugin) {
        if (!v.plugin.storage) v.plugin.storage = {};
        v.plugin.storage.accounts = JSON.parse(JSON.stringify(clean));
      }
    } catch {}

    // 2. Save to ReactNative AsyncStorage
    try {
      const AsyncStorage =
        v.metro?.common?.ReactNative?.AsyncStorage ||
        v.metro?.findByProps?.("getItem", "setItem", "multiGet");
      if (AsyncStorage?.setItem) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
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
      const AuthStore = v.metro?.findByStoreName?.("AuthenticationStore");
      const t1 = AuthStore?.getToken?.();
      if (t1 && typeof t1 === "string" && t1.length > 20) return t1;
    } catch {}
    try {
      const TokenMod = v.metro?.findByProps?.("getToken", "setToken");
      const t2 = TokenMod?.getToken?.();
      if (t2 && typeof t2 === "string" && t2.length > 20) return t2;
    } catch {}
    try {
      const TokenMod2 = v.metro?.findByProps?.("getToken", "removeToken");
      const t3 = TokenMod2?.getToken?.();
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
    const list = [...memAccounts];
    const idx = list.findIndex((a) => (entry.id && a.id === entry.id) || a.token === entry.token);
    const cleanEntry = {
      id: String(entry.id || Date.now()),
      username: entry.username || "unknown",
      globalName: entry.globalName || entry.username || "Discord User",
      avatar: entry.avatar || null,
      token: String(entry.token).trim(),
      addedAt: Date.now()
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...cleanEntry };
    else list.push(cleanEntry);
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
    } else if (user && !memAccounts.some((a) => a.id === user.id)) {
      // Even if token store is shielded, show active account card so user sees it
      await saveAccountEntry({
        id: user.id,
        username: user.username,
        globalName: user.globalName || user.username,
        avatar: user.avatar || null,
        token: token || "ACTIVE_SESSION"
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

  function SwitcherScreen({ onClose }) {
    const v = getV();
    const React = v.metro?.common?.React;
    const RN = v.metro?.common?.ReactNative;
    if (!React || !RN) return null;

    const { ScrollView, View, Text, Pressable, TextInput, Image, SafeAreaView } = RN;
    const [accounts, setAccounts] = React.useState([...memAccounts]);
    const [showAddForm, setShowAddForm] = React.useState(false);
    const [addType, setAddType] = React.useState("token"); // "token" | "login" | "mfa"
    const [loginId, setLoginId] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [mfaTicket, setMfaTicket] = React.useState("");
    const [mfaCode, setMfaCode] = React.useState("");
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

    const handleTokenSave = async () => {
      if (!rawToken.trim()) {
        setErrorMsg("Paste a valid Discord token.");
        return;
      }
      setLoading(true);
      setErrorMsg("");
      try {
        const profile = await fetchUserByToken(rawToken);
        const updated = await saveAccountEntry(profile);
        setAccounts([...updated]);
        setRawToken("");
        setShowAddForm(false);
        v.ui?.toasts?.showToast?.(`Saved @${profile.username}`);
      } catch (e) {
        setErrorMsg(e?.message || "Invalid or expired token.");
      } finally {
        setLoading(false);
      }
    };

    const handleCredentialSave = async () => {
      if (!loginId.trim() || !password) {
        setErrorMsg("Enter email/phone and password.");
        return;
      }
      setLoading(true);
      setErrorMsg("");
      try {
        const res = await fetch("https://discord.com/api/v9/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login: loginId.trim(), password, undelete: false })
        });
        const data = await res.json();

        if (data.token) {
          const profile = await fetchUserByToken(data.token);
          const updated = await saveAccountEntry(profile);
          setAccounts([...updated]);
          setLoginId("");
          setPassword("");
          setShowAddForm(false);
          v.ui?.toasts?.showToast?.(`Saved @${profile.username}`);
        } else if (data.ticket) {
          setMfaTicket(data.ticket);
          setAddType("mfa");
        } else {
          const msg =
            data.errors?.login?._errors?.[0]?.message ||
            data.errors?.password?._errors?.[0]?.message ||
            data.message ||
            "Discord blocked direct login (Captcha). Switch to 'By Token' above.";
          setErrorMsg(msg);
        }
      } catch {
        setErrorMsg("Network error. Try 'By Token'.");
      } finally {
        setLoading(false);
      }
    };

    const handleVerifyMfa = async () => {
      if (!mfaCode.trim() || !mfaTicket) return;
      setLoading(true);
      setErrorMsg("");
      try {
        const res = await fetch("https://discord.com/api/v9/auth/mfa/totp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: mfaCode.trim(), ticket: mfaTicket })
        });
        const data = await res.json();
        if (data.token) {
          const profile = await fetchUserByToken(data.token);
          const updated = await saveAccountEntry(profile);
          setAccounts([...updated]);
          setMfaCode("");
          setMfaTicket("");
          setShowAddForm(false);
          setAddType("token");
          v.ui?.toasts?.showToast?.(`Saved @${profile.username}`);
        } else {
          setErrorMsg(data.message || "Invalid verification code.");
        }
      } catch {
        setErrorMsg("Verification failed.");
      } finally {
        setLoading(false);
      }
    };

    const handleDelete = async (id) => {
      const next = accounts.filter((a) => a.id !== id);
      await persistAccountsToDisk(next);
      setAccounts([...next]);
      v.ui?.toasts?.showToast?.("Account removed");
    };

    const Container = SafeAreaView || View;

    return React.createElement(
      Container,
      { style: { flex: 1, backgroundColor: "#111214" } },
      // Minimalist Discord-native Header
      React.createElement(
        View,
        {
          style: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 18,
            paddingVertical: 16,
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

      // Clean Account List
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
                "Tap '+ Add Account' below to save your accounts."
              )
            )
          : accounts.map((acc) => {
              const isActive = currentUser?.id === acc.id || (currentToken && currentToken === acc.token);
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
                // Circular Avatar
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
                // Name & Username
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
                // Clean Copy Token Button
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
                // Clean Delete Button (only for non-active)
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

        // Expandable Add Account Sheet (Only appears when '+ Add Account' is clicked)
        showAddForm
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
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
                React.createElement(
                  Text,
                  { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" } },
                  "Add Account"
                ),
                React.createElement(
                  View,
                  { style: { flexDirection: "row", backgroundColor: "#111214", borderRadius: 8, padding: 3 } },
                  React.createElement(
                    Pressable,
                    {
                      style: {
                        backgroundColor: addType === "token" ? "#5865F2" : "transparent",
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 6
                      },
                      onPress: () => { setErrorMsg(""); setAddType("token"); }
                    },
                    React.createElement(Text, { style: { color: "#FFF", fontSize: 12, fontWeight: "600" } }, "Token")
                  ),
                  React.createElement(
                    Pressable,
                    {
                      style: {
                        backgroundColor: addType === "login" || addType === "mfa" ? "#5865F2" : "transparent",
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 6
                      },
                      onPress: () => { setErrorMsg(""); setAddType("login"); }
                    },
                    React.createElement(Text, { style: { color: "#FFF", fontSize: 12, fontWeight: "600" } }, "Email / Pass")
                  )
                )
              ),
              errorMsg
                ? React.createElement(
                    Text,
                    { style: { color: "#F23F43", fontSize: 12, marginBottom: 10 } },
                    errorMsg
                  )
                : null,
              addType === "token"
                ? React.createElement(
                    View,
                    null,
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
                        onPress: loading ? undefined : handleTokenSave
                      },
                      React.createElement(
                        Text,
                        { style: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 } },
                        loading ? "Saving..." : "Save Account"
                      )
                    )
                  )
                : null,
              addType === "login"
                ? React.createElement(
                    View,
                    null,
                    React.createElement(TextInput, {
                      style: {
                        backgroundColor: "#111214",
                        color: "#FFFFFF",
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 11,
                        marginBottom: 8
                      },
                      placeholder: "Email or Phone",
                      placeholderTextColor: "#72767D",
                      value: loginId,
                      onChangeText: setLoginId,
                      autoCapitalize: "none"
                    }),
                    React.createElement(TextInput, {
                      style: {
                        backgroundColor: "#111214",
                        color: "#FFFFFF",
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 11,
                        marginBottom: 10
                      },
                      placeholder: "Password",
                      placeholderTextColor: "#72767D",
                      value: password,
                      onChangeText: setPassword,
                      secureTextEntry: true
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
                        onPress: loading ? undefined : handleCredentialSave
                      },
                      React.createElement(
                        Text,
                        { style: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 } },
                        loading ? "Logging in..." : "Save Account"
                      )
                    )
                  )
                : null,
              addType === "mfa"
                ? React.createElement(
                    View,
                    null,
                    React.createElement(TextInput, {
                      style: {
                        backgroundColor: "#111214",
                        color: "#FFFFFF",
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 11,
                        marginBottom: 10
                      },
                      placeholder: "6-digit 2FA / Email code",
                      placeholderTextColor: "#72767D",
                      value: mfaCode,
                      onChangeText: setMfaCode
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
                        onPress: loading ? undefined : handleVerifyMfa
                      },
                      React.createElement(
                        Text,
                        { style: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 } },
                        loading ? "Verifying..." : "Verify & Save"
                      )
                    )
                  )
                : null
            )
          : null,

        React.createElement(View, { style: { height: 24 } })
      ),

      // Bottom Primary "+ Add Account" Button
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
              backgroundColor: showAddForm ? "#2B2D31" : "#5865F2",
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center"
            },
            onPress: () => {
              setErrorMsg("");
              setShowAddForm(!showAddForm);
            }
          },
          React.createElement(
            Text,
            { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" } },
            showAddForm ? "Cancel" : "+ Add Account"
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
        setGlobalModalOpen = setVisible;
        return () => {
          setGlobalModalOpen = null;
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
          return React.cloneElement(res, {}, origChildren, React.createElement(SwitcherModalHost, { key: "pegasus-switcher-modal-host" }));
        }
        return res;
      });
      if (typeof unpatch === "function") unpatches.push(unpatch);
    } catch {}
  };

  const openFullScreenSwitcher = async () => {
    await syncCurrentAccount();
    if (typeof setGlobalModalOpen === "function") {
      setGlobalModalOpen(true);
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
                key: "pegasus-switch-account-v17",
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
      setGlobalModalOpen = null;
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
