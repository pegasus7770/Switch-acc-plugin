(() => {
  const unpatches = [];
  let memAccounts = [];
  const STORAGE_KEY = "PEGASUS_GLOBAL_ACCOUNTS_DB_V18";
  const FILE_NAME = "pegasus_switch_accounts_v18.json";

  const getV = () => window.vendetta || window.bunny || window.revenge || {};

  // 1. Native FileSystem + MMKV + PluginStorage persistence (never wiped on account switch or app restart)
  const getNativeFS = () => {
    const v = getV();
    try {
      const RN = v.metro?.common?.ReactNative;
      const nm = RN?.NativeModules || {};
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

  const getMMKV = () => {
    const v = getV();
    try {
      return (
        v.metro?.findByProps?.("getString", "set", "delete") ||
        v.metro?.findByProps?.("getItem", "setItem", "removeItem") ||
        null
      );
    } catch {
      return null;
    }
  };

  const loadAccountsFromDisk = async () => {
    const v = getV();
    let best = [...memAccounts];

    // Layer A: Native File on Device Storage (survives account switch & force close)
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

    // Layer B: MMKV / Storage
    try {
      const kv = getMMKV();
      if (kv) {
        const raw = kv.getString ? kv.getString(STORAGE_KEY) : await kv.getItem?.(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > best.length) best = parsed;
        }
      }
    } catch {}

    // Layer C: Plugin storage
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

    // Layer A: Native File on Device Storage
    try {
      const fs = getNativeFS();
      const path = getFilePath(fs);
      if (fs && path && fs.writeFile) {
        await fs.writeFile(path, serialized, "utf8");
      }
    } catch {}

    // Layer B: MMKV / Storage
    try {
      const kv = getMMKV();
      if (kv) {
        if (kv.set) kv.set(STORAGE_KEY, serialized);
        else if (kv.setItem) await kv.setItem(STORAGE_KEY, serialized);
      }
    } catch {}

    // Layer C: Plugin storage
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
      v.ui?.toasts?.showToast?.("Save this account's token first to switch back to it.");
      return;
    }

    const targetToken = String(targetAccount.token).trim();
    try {
      // Save current account + target account to disk BEFORE switching
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

  function SwitcherScreen({ navigation }) {
    const v = getV();
    const React = v.metro?.common?.React;
    const RN = v.metro?.common?.ReactNative;
    if (!React || !RN) return null;

    const { ScrollView, View, Text, Pressable, TextInput, Image, SafeAreaView } = RN;
    const [accounts, setAccounts] = React.useState([...memAccounts]);
    const [showAddForm, setShowAddForm] = React.useState(false);
    const [addType, setAddType] = React.useState("token");
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

    const closeScreen = () => {
      try {
        navigation?.goBack?.();
      } catch {}
    };

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
            "Discord blocked direct login (Captcha). Use 'Token' tab.";
          setErrorMsg(msg);
        }
      } catch {
        setErrorMsg("Network error. Try 'Token'.");
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
      const next = accounts.filter((a) => String(a.id) !== String(id));
      await persistAccountsToDisk(next);
      setAccounts([...next]);
      v.ui?.toasts?.showToast?.("Account removed");
    };

    const Container = SafeAreaView || View;

    return React.createElement(
      Container,
      { style: { flex: 1, backgroundColor: "#111214" } },
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
                  marginTop: 12
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
                    if (!isActive) performSilentSwitch(acc, closeScreen);
                  }
                },
                Image
                  ? React.createElement(Image, {
                      source: { uri: getAvatarUrl(acc) },
                      style: {
                        width: 48,
                        height: 48,
                        borderRadius: 24,
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

  // Zero-conflict navigation: uses native Bunny/Revenge page routing without patching global RN.View
  const openNativePage = (navProp) => {
    const v = getV();
    syncCurrentAccount();

    if (navProp && typeof navProp.push === "function") {
      try {
        navProp.push("BUNNY_CUSTOM_PAGE", {
          title: "Switch Account",
          render: () => v.metro.common.React.createElement(SwitcherScreen, { navigation: navProp })
        });
        return;
      } catch {}
      try {
        navProp.push("VENDETTA_CUSTOM_PAGE", {
          title: "Switch Account",
          render: () => v.metro.common.React.createElement(SwitcherScreen, { navigation: navProp })
        });
        return;
      } catch {}
    }

    try {
      const NavNative = v.metro?.findByProps?.("NavigationContainerRef", "useNavigation");
      const ref = NavNative?.NavigationContainerRef?.current;
      if (ref?.navigate) {
        ref.navigate("BUNNY_CUSTOM_PAGE", {
          title: "Switch Account",
          render: () => v.metro.common.React.createElement(SwitcherScreen, { navigation: ref })
        });
        return;
      }
    } catch {}
  };

  const registerSettingsIsolated = () => {
    const targets = [window.bunny, window.vendetta, window.revenge].filter(Boolean);
    for (const t of targets) {
      const s = t.ui?.settings;
      if (!s || typeof s.registerSection !== "function") continue;

      let iconAsset;
      try {
        iconAsset =
          t.ui?.assets?.getAssetIDByName?.("ic_account_circle_24px") ||
          t.ui?.assets?.getAssetIDByName?.("ic_person_24px") ||
          t.ui?.assets?.getAssetIDByName?.("ic_settings_24px");
      } catch {}

      try {
        const u = s.registerSection({
          name: "Account Switcher",
          items: [
            {
              key: "pegasus-isolated-account-switcher-v18",
              title: () => "Switch Account",
              icon: iconAsset,
              render: SwitcherScreen,
              onPress: (nav) => openNativePage(nav),
              usePredicate: () => true
            }
          ]
        });
        if (typeof u === "function") unpatches.push(u);
        break;
      } catch {}
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
          execute: () => openNativePage(null)
        });
        if (typeof unreg === "function") unpatches.push(unreg);
      } catch {}
    }
  };

  return {
    async onLoad() {
      try {
        await syncCurrentAccount();
        registerSettingsIsolated();
        registerSlashCommand();
      } catch (e) {
        console.error("[AccountSwitcher] onLoad:", e);
      }
    },
    onUnload() {
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
