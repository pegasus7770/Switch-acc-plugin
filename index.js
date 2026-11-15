(() => {
  const unpatches = [];
  const getV = () => window.bunny || window.vendetta || {};

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
      token: cleanToken
    };
  };

  const performSilentSwitch = async (targetAccount) => {
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
        return;
      }

      if (AuthActions?.loginToken) {
        await AuthActions.loginToken(targetToken);
        v.ui?.toasts?.showToast?.(`Switched to ${verified.username}`);
        return;
      }

      if (TokenManager?.setToken) {
        TokenManager.setToken(targetToken);
        FluxDispatcher?.dispatch?.({
          type: "LOGIN_SUCCESS",
          token: targetToken
        });
        v.ui?.toasts?.showToast?.(`Applied token for ${verified.username}`);
        return;
      }

      v.ui?.toasts?.showToast?.("Token verified! Copy Token if needed.");
    } catch (err) {
      v.ui?.toasts?.showToast?.(`Switch error: ${err?.message || "Expired token"}`);
    }
  };

  function SwitcherScreen({ onClose }) {
    const v = getV();
    const React = v.metro?.common?.React;
    const RN = v.metro?.common?.ReactNative;
    if (!React || !RN) return null;

    const { ScrollView, View, Text, Pressable, TextInput } = RN;
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
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: "#2B2D31"
    };

    const inputStyle = {
      backgroundColor: "#111214",
      color: "#FFFFFF",
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: "#3F4147"
    };

    const btn = (bg) => ({
      backgroundColor: bg,
      borderRadius: 8,
      paddingVertical: 11,
      paddingHorizontal: 14,
      alignItems: "center",
      marginBottom: 8
    });

    return React.createElement(
      ScrollView,
      { style: { flex: 1, backgroundColor: "#111214", padding: 14 } },
      React.createElement(
        View,
        { style: card },
        React.createElement(
          View,
          { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" } },
          React.createElement(
            Text,
            { style: { color: "#FFFFFF", fontSize: 18, fontWeight: "bold" } },
            "Account Switcher v8"
          ),
          onClose
            ? React.createElement(
                Pressable,
                {
                  style: { backgroundColor: "#DA373C", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
                  onPress: onClose
                },
                React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 12 } }, "Close")
              )
            : null
        ),
        React.createElement(
          Text,
          { style: { color: "#B5BAC1", fontSize: 12, marginTop: 4 } },
          "Silent account switcher — preserves active session tokens without calling Log Out."
        ),
        statusMsg
          ? React.createElement(Text, { style: { color: "#F0B232", fontSize: 12, marginTop: 8 } }, statusMsg)
          : null
      ),
      React.createElement(
        View,
        { style: { flexDirection: "row", gap: 8, marginBottom: 12 } },
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
      mode === "list"
        ? React.createElement(
            View,
            null,
            accounts.length === 0
              ? React.createElement(
                  View,
                  { style: card },
                  React.createElement(Text, { style: { color: "#B5BAC1", fontSize: 13 } }, "No accounts saved yet.")
                )
              : accounts.map((acc) => {
                  const isActive = currentUser?.id === acc.id || (currentToken && currentToken === acc.token);
                  return React.createElement(
                    View,
                    {
                      key: acc.id + acc.token.slice(0, 8),
                      style: { ...card, borderColor: isActive ? "#248046" : "#2B2D31" }
                    },
                    React.createElement(
                      Text,
                      { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold" } },
                      `${acc.globalName} (@${acc.username})${isActive ? "  [ACTIVE]" : ""}`
                    ),
                    React.createElement(
                      Text,
                      { style: { color: "#949BA4", fontSize: 12, marginTop: 2, marginBottom: 10 } },
                      `ID: ${acc.id}`
                    ),
                    React.createElement(
                      View,
                      { style: { flexDirection: "row", gap: 8 } },
                      !isActive
                        ? React.createElement(
                            Pressable,
                            {
                              style: { ...btn("#5865F2"), flex: 2, marginBottom: 0 },
                              onPress: () => performSilentSwitch(acc)
                            },
                            React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 13 } }, "Switch")
                          )
                        : null,
                      React.createElement(
                        Pressable,
                        {
                          style: { ...btn("#4E5058"), flex: 2, marginBottom: 0 },
                          onPress: () => copyText(acc.token, `${acc.username}'s Token`)
                        },
                        React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 13 } }, "Copy Token")
                      ),
                      !isActive
                        ? React.createElement(
                            Pressable,
                            {
                              style: { ...btn("#DA373C"), flex: 1, marginBottom: 0 },
                              onPress: () => removeAccount(acc.id)
                            },
                            React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold", fontSize: 13 } }, "Del")
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
              { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold", marginBottom: 8 } },
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
              React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold" } }, loading ? "Logging in..." : "Save Account")
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
              { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold", marginBottom: 6 } },
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
              React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold" } }, loading ? "Verifying..." : "Verify & Save")
            )
          )
        : null,
      mode === "add_token"
        ? React.createElement(
            View,
            { style: card },
            React.createElement(
              Text,
              { style: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold", marginBottom: 8 } },
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
              React.createElement(Text, { style: { color: "#FFF", fontWeight: "bold" } }, loading ? "Validating..." : "Save Token")
            )
          )
        : null,
      React.createElement(View, { style: { height: 40 } })
    );
  }

  // Global overlay state so tapping "Switch Account" ALWAYS opens the UI even if React Navigation route names change
  let setOverlayOpen = null;

  const openSwitcher = () => {
    const v = getV();
    const React = v.metro?.common?.React;

    // 1. Primary guaranteed method: React Native Modal overlay mounted at root
    if (typeof setOverlayOpen === "function") {
      setOverlayOpen(true);
      return;
    }

    // 2. Fallback: Try React Navigation / Navigator push
    try {
      const NavMod = v.metro?.findByProps?.("NavigationContainerRef") || v.metro?.findByProps?.("useNavigation");
      const Navigator = v.ui?.components?.Navigator || v.metro?.findByProps?.("Navigator")?.Navigator;
      if (Navigator?.push && React) {
        Navigator.push({
          title: "Switch Account",
          render: () => React.createElement(SwitcherScreen)
        });
        return;
      }
      if (NavMod?.navigate) {
        NavMod.navigate("BUNNY_CUSTOM_PAGE", {
          title: "Switch Account",
          render: SwitcherScreen
        });
        return;
      }
    } catch {}

    v.ui?.toasts?.showToast?.("Open Revenge > Plugins > AccountSwitcher gear icon");
  };

  const mountRootOverlayAndPatch = () => {
    const v = getV();
    const { metro, patcher } = v;
    const React = metro?.common?.React;
    const RN = metro?.common?.ReactNative;
    if (!metro || !patcher || !React || !RN) return;

    const { Modal, SafeAreaView } = RN;

    // Mount a lightweight Modal controller inside App / TableRowGroup so openSwitcher() works 100% of the time
    function SwitcherModalController() {
      const [visible, setVisible] = React.useState(false);
      React.useEffect(() => {
        setOverlayOpen = setVisible;
        return () => {
          if (setOverlayOpen === setVisible) setOverlayOpen = null;
        };
      }, []);

      if (!visible || !Modal) return null;
      return React.createElement(
        Modal,
        {
          visible: true,
          animationType: "slide",
          onRequestClose: () => setVisible(false)
        },
        React.createElement(
          SafeAreaView || RN.View,
          { style: { flex: 1, backgroundColor: "#111214" } },
          React.createElement(SwitcherScreen, { onClose: () => setVisible(false) })
        )
      );
    }

    const TableMod = metro.findByProps?.("TableRowGroup", "TableRow");
    if (TableMod?.TableRowGroup && TableMod?.TableRow) {
      const { TableRow, TableRowIcon } = TableMod;
      let iconAsset;
      try {
        iconAsset =
          v.ui?.assets?.getAssetIDByName?.("UserIcon") ||
          v.ui?.assets?.getAssetIDByName?.("ic_account_circle_24px") ||
          v.ui?.assets?.getAssetIDByName?.("ic_person_24px") ||
          v.ui?.assets?.getAssetIDByName?.("ic_settings_24px");
      } catch {}

      unpatches.push(
        patcher.before("TableRowGroup", TableMod, (args) => {
          try {
            const props = args?.[0];
            if (!props || !props.children) return;
            const title = String(props.title || "");
            const childrenArr = Array.isArray(props.children) ? props.children : [props.children];

            const isTargetGroup =
              /revenge|bunny|vendetta/i.test(title) ||
              childrenArr.some((c) => {
                const lbl = String(c?.props?.label || c?.props?.title || "");
                return lbl === "Plugins" || lbl === "Log Out";
              });

            if (!isTargetGroup) return;

            const alreadyInjected = childrenArr.some(
              (c) => c?.key === "pegasus-switch-account-row"
            );
            if (alreadyInjected) return;

            const savedCount = (getStorage().accounts || []).length;
            const switchRow = React.createElement(TableRow, {
              key: "pegasus-switch-account-row",
              label: "Switch Account",
              subLabel: `${savedCount} saved account(s)`,
              icon: TableRowIcon && iconAsset ? React.createElement(TableRowIcon, { source: iconAsset }) : undefined,
              onPress: () => openSwitcher()
            });

            const modalHost = React.createElement(SwitcherModalController, {
              key: "pegasus-switch-account-modal"
            });

            props.children = [...childrenArr, switchRow, modalHost];
          } catch {}
        })
      );
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
          execute: () => openSwitcher()
        });
        if (typeof unreg === "function") unpatches.push(unreg);
      } catch {}
    }
  };

  return {
    onLoad() {
      try {
        syncCurrentAccount();
        mountRootOverlayAndPatch();
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
