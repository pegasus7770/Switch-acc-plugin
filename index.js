(() => {
  const unpatches = [];
  let setGlobalModalOpen = null;
  const getV = () => window.vendetta || window.bunny || window.revenge || {};

  const getStorage = () => {
    const v = getV();
    if (!v.plugin) return {};
    if (!v.plugin.storage) v.plugin.storage = {};
    if (!Array.isArray(v.plugin.storage.accounts)) v.plugin.storage.accounts = [];
    return v.plugin.storage;
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
    const idx = Number(BigInt(userObj.id) >> 22n) % 6;
    return `https://cdn.discordapp.com/embed/avatars/${isNaN(idx) ? 0 : idx}.png`;
  };

  const getCurrentToken = () => {
    const v = getV();
    try {
      const AuthStore = v.metro?.findByStoreName?.("AuthenticationStore");
      const t1 = AuthStore?.getToken?.();
      if (t1) return t1;
      const TokenMod = v.metro?.findByProps?.("getToken", "setToken");
      const t2 = TokenMod?.getToken?.();
      if (t2) return t2;
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

  const saveAccountEntry = (entry) => {
    if (!entry || !entry.token) return;
    const store = getStorage();
    const list = store.accounts || [];
    const idx = list.findIndex((a) => (entry.id && a.id === entry.id) || a.token === entry.token);
    const cleanEntry = {
      id: entry.id || "unknown",
      username: entry.username || "Unknown User",
      globalName: entry.globalName || entry.username || "Discord User",
      avatar: entry.avatar || null,
      token: entry.token,
      addedAt: Date.now()
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...cleanEntry };
    else list.push(cleanEntry);
    store.accounts = [...list];
  };

  const syncCurrentAccount = () => {
    const user = getCurrentUser();
    const token = getCurrentToken();
    if (user && token) {
      saveAccountEntry({
        id: user.id,
        username: user.username,
        globalName: user.globalName || user.username,
        avatar: user.avatar || null,
        token
      });
    }
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
    if (!targetAccount?.token) return;
    syncCurrentAccount();

    const targetToken = String(targetAccount.token).trim();
    try {
      const verified = await fetchUserByToken(targetToken);
      saveAccountEntry(verified);

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
        v.ui?.toasts?.showToast?.(`Applied token for ${verified.username}`);
        onDone?.();
        return;
      }

      v.ui?.toasts?.showToast?.("Token verified! Use Copy Token if needed.");
    } catch (err) {
      v.ui?.toasts?.showToast?.(`Switch error: ${err?.message || "Expired token"}`);
    }
  };

  function SwitcherScreen({ onClose }) {
    const v = getV();
    const React = v.metro?.common?.React;
    const RN = v.metro?.common?.ReactNative;
    if (!React || !RN) return null;

    const { ScrollView, View, Text, Pressable, TextInput, Image, SafeAreaView } = RN;
    const [, rerender] = React.useState(0);
    const [mode, setMode] = React.useState("list");
    const [loginId, setLoginId] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [mfaTicket, setMfaTicket] = React.useState("");
    const [mfaCode, setMfaCode] = React.useState("");
    const [rawToken, setRawToken] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [statusMsg, setStatusMsg] = React.useState("");

    React.useEffect(() => {
      syncCurrentAccount();
      rerender((n) => n + 1);
    }, []);

    const store = getStorage();
    const accounts = store.accounts || [];
    const currentUser = getCurrentUser();
    const currentToken = getCurrentToken();

    const handleCredentialLogin = async () => {
      if (!loginId.trim() || !password) {
        setStatusMsg("Enter email/phone and password.");
        return;
      }
      setLoading(true);
      setStatusMsg("Logging in silently...");
      try {
        const res = await fetch("https://discord.com/api/v9/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login: loginId.trim(), password, undelete: false })
        });
        const data = await res.json();

        if (data.token) {
          const profile = await fetchUserByToken(data.token);
          saveAccountEntry(profile);
          setStatusMsg(`Saved ${profile.username} without logging out!`);
          setLoginId("");
          setPassword("");
          setMode("list");
          v.ui?.toasts?.showToast?.(`Added ${profile.username}`);
        } else if (data.ticket) {
          setMfaTicket(data.ticket);
          setStatusMsg("Verification code required (Email / 2FA).");
          setMode("verify_code");
        } else {
          const errDetail =
            data.errors?.login?._errors?.[0]?.message ||
            data.errors?.password?._errors?.[0]?.message ||
            data.message ||
            "Captcha or login block. Use '+ Token' tab instead.";
          setStatusMsg(errDetail);
        }
      } catch {
        setStatusMsg("Network error. Use '+ Token' tab.");
      } finally {
        setLoading(false);
      }
    };

    const handleVerifyCode = async () => {
      if (!mfaCode.trim() || !mfaTicket) return;
      setLoading(true);
      setStatusMsg("Verifying code...");
      try {
        const res = await fetch("https://discord.com/api/v9/auth/mfa/totp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: mfaCode.trim(), ticket: mfaTicket })
        });
        const data = await res.json();
        if (data.token) {
          const profile = await fetchUserByToken(data.token);
          saveAccountEntry(profile);
          setMfaCode("");
          setMfaTicket("");
          setStatusMsg(`Verified & saved ${profile.username}!`);
          setMode("list");
          v.ui?.toasts?.showToast?.(`Added ${profile.username}`);
        } else {
          setStatusMsg(data.message || "Invalid verification code.");
        }
      } catch {
        setStatusMsg("Verification failed.");
      } finally {
        setLoading(false);
      }
    };

    const handleTokenAdd = async () => {
      if (!rawToken.trim()) {
        setStatusMsg("Paste a Discord token.");
        return;
      }
      setLoading(true);
      setStatusMsg("Validating token...");
      try {
        const profile = await fetchUserByToken(rawToken);
        saveAccountEntry(profile);
        setRawToken("");
        setStatusMsg(`Added ${profile.username}!`);
        setMode("list");
        v.ui?.toasts?.showToast?.(`Added ${profile.username}`);
      } catch (e) {
        setStatusMsg(e?.message || "Invalid token.");
      } finally {
        setLoading(false);
      }
    };

    const removeAccount = (id) => {
      store.accounts = (store.accounts || []).filter((a) => a.id !== id);
      rerender((n) => n + 1);
      v.ui?.toasts?.showToast?.("Removed account");
    };

    const card = {
      backgroundColor: "#1E1F22",
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: "#2B2D31"
    };

    const inputStyle = {
      backgroundColor: "#111214",
      color: "#FFFFFF",
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: "#3F4147"
    };

    const btn = (bg) => ({
      backgroundColor: bg,
      borderRadius: 10,
      paddingVertical: 11,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8
    });

    const Container = SafeAreaView || View;

    return React.createElement(
      Container,
      { style: { flex: 1, backgroundColor: "#111214" } },
      // Top Full-Screen Header Bar
      React.createElement(
        View,
        {
          style: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 14,
            backgroundColor: "#18191C",
            borderBottomWidth: 1,
            borderBottomColor: "#2B2D31"
          }
        },
        React.createElement(
          Text,
          { style: { color: "#FFFFFF", fontSize: 19, fontWeight: "bold" } },
          "Account Switcher"
        ),
        onClose
          ? React.createElement(
              Pressable,
              {
                style: {
                  backgroundColor: "#2B2D31",
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 10
                },
                onPress: onClose
              },
              React.createElement(Text, { style: { color: "#FFFFFF", fontWeight: "bold", fontSize: 13 } }, "← Back")
            )
          : null
      ),
      React.createElement(
        ScrollView,
        { style: { flex: 1, padding: 14 } },
        statusMsg
          ? React.createElement(
              View,
              { style: { ...card, borderColor: "#F0B232", padding: 10 } },
              React.createElement(Text, { style: { color: "#F0B232", fontSize: 13 } }, statusMsg)
            )
          : null,
        // Navigation Tabs
        React.createElement(
          View,
          { style: { flexDirection: "row", gap: 8, marginBottom: 14 } },
          React.createElement(
            Pressable,
            {
              style: { ...btn(mode === "list" ? "#5865F2" : "#2B2D31"), flex: 1 },
              onPress: () => { setStatusMsg(""); setMode("list"); }
            },
            React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 13 } }, `Accounts (${accounts.length})`)
          ),
          React.createElement(
            Pressable,
            {
              style: { ...btn(mode === "add_credentials" || mode === "verify_code" ? "#248046" : "#2B2D31"), flex: 1 },
              onPress: () => { setStatusMsg(""); setMode("add_credentials"); }
            },
            React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 13 } }, "+ Add Account")
          ),
          React.createElement(
            Pressable,
            {
              style: { ...btn(mode === "add_token" ? "#248046" : "#2B2D31"), flex: 1 },
              onPress: () => { setStatusMsg(""); setMode("add_token"); }
            },
            React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 13 } }, "+ Token")
          )
        ),
        // Saved Accounts List with Avatars, Names, Switch on Tap, and Copy Button
        mode === "list"
          ? React.createElement(
              View,
              null,
              accounts.length === 0
                ? React.createElement(
                    View,
                    { style: card },
                    React.createElement(Text, { style: { color: "#B5BAC1", fontSize: 14 } }, "No accounts saved yet. Tap '+ Add Account' or '+ Token'.")
                  )
                : accounts.map((acc) => {
                    const isActive = currentUser?.id === acc.id || (currentToken && currentToken === acc.token);
                    return React.createElement(
                      Pressable,
                      {
                        key: acc.id + acc.token.slice(0, 8),
                        style: {
                          ...card,
                          borderColor: isActive ? "#248046" : "#2B2D31",
                          borderWidth: isActive ? 1.5 : 1
                        },
                        onPress: () => {
                          if (!isActive) performSilentSwitch(acc, onClose);
                        }
                      },
                      React.createElement(
                        View,
                        { style: { flexDirection: "row", alignItems: "center" } },
                        Image
                          ? React.createElement(Image, {
                              source: { uri: getAvatarUrl(acc) },
                              style: {
                                width: 48,
                                height: 48,
                                borderRadius: 24,
                                marginRight: 12,
                                backgroundColor: "#2B2D31"
                              }
                            })
                          : null,
                        React.createElement(
                          View,
                          { style: { flex: 1 } },
                          React.createElement(
                            Text,
                            { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold" }, numberOfLines: 1 },
                            acc.globalName
                          ),
                          React.createElement(
                            Text,
                            { style: { color: "#B5BAC1", fontSize: 13, marginTop: 2 } },
                            `@${acc.username}${isActive ? "  •  Active" : "  •  Tap to switch"}`
                          )
                        ),
                        React.createElement(
                          Pressable,
                          {
                            style: {
                              backgroundColor: "#4E5058",
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 8,
                              marginLeft: 8
                            },
                            onPress: (e) => {
                              e?.stopPropagation?.();
                              copyText(acc.token, `${acc.username}'s Token`);
                            }
                          },
                          React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 12 } }, "Copy")
                        ),
                        !isActive
                          ? React.createElement(
                              Pressable,
                              {
                                style: {
                                  backgroundColor: "#DA373C",
                                  paddingHorizontal: 10,
                                  paddingVertical: 8,
                                  borderRadius: 8,
                                  marginLeft: 6
                                },
                                onPress: (e) => {
                                  e?.stopPropagation?.();
                                  removeAccount(acc.id);
                                }
                              },
                              React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 12 } }, "✕")
                            )
                          : null
                      )
                    );
                  })
            )
          : null,
        mode === "add_credentials"
          ? React.createElement(
              View,
              { style: card },
              React.createElement(
                Text,
                { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold", marginBottom: 10 } },
                "Add Account (Without Logging Out)"
              ),
              React.createElement(TextInput, {
                style: inputStyle,
                placeholder: "Email or Phone",
                placeholderTextColor: "#72767D",
                value: loginId,
                onChangeText: setLoginId,
                autoCapitalize: "none"
              }),
              React.createElement(TextInput, {
                style: inputStyle,
                placeholder: "Password",
                placeholderTextColor: "#72767D",
                value: password,
                onChangeText: setPassword,
                secureTextEntry: true
              }),
              React.createElement(
                Pressable,
                { style: btn("#248046"), onPress: loading ? undefined : handleCredentialLogin },
                React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 14 } }, loading ? "Logging in..." : "Save Account")
              ),
              React.createElement(
                Pressable,
                { style: btn("#2B2D31"), onPress: () => { setStatusMsg(""); setMode("add_token"); } },
                React.createElement(Text, { style: { color: "#00A8FC", fontSize: 13 } }, "Login issue / Captcha? Use Token instead")
              )
            )
          : null,
        mode === "verify_code"
          ? React.createElement(
              View,
              { style: card },
              React.createElement(
                Text,
                { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold", marginBottom: 8 } },
                "Enter Verification Code"
              ),
              React.createElement(TextInput, {
                style: inputStyle,
                placeholder: "6-digit Email / 2FA code",
                placeholderTextColor: "#72767D",
                value: mfaCode,
                onChangeText: setMfaCode
              }),
              React.createElement(
                Pressable,
                { style: btn("#248046"), onPress: loading ? undefined : handleVerifyCode },
                React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 14 } }, loading ? "Verifying..." : "Verify & Save")
              )
            )
          : null,
        mode === "add_token"
          ? React.createElement(
              View,
              { style: card },
              React.createElement(
                Text,
                { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold", marginBottom: 10 } },
                "Add Account via Token"
              ),
              React.createElement(TextInput, {
                style: inputStyle,
                placeholder: "Paste Discord token...",
                placeholderTextColor: "#72767D",
                value: rawToken,
                onChangeText: setRawToken,
                autoCapitalize: "none"
              }),
              React.createElement(
                Pressable,
                { style: btn("#248046"), onPress: loading ? undefined : handleTokenAdd },
                React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 14 } }, loading ? "Validating..." : "Save Token")
              )
            )
          : null,
        React.createElement(View, { style: { height: 40 } })
      )
    );
  }

  // Full-Screen React Native Modal Overlay injected at root App layer
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

  const openFullScreenSwitcher = () => {
    syncCurrentAccount();
    if (typeof setGlobalModalOpen === "function") {
      setGlobalModalOpen(true);
      return;
    }
    const v = getV();
    v.ui?.toasts?.showToast?.("Reload Discord once to activate full-screen Switcher");
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
                key: "pegasus-switch-account-v16",
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
          description: "Open Full-Screen Account Switcher",
          displayDescription: "Open Full-Screen Account Switcher",
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
    onLoad() {
      try {
        syncCurrentAccount();
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
