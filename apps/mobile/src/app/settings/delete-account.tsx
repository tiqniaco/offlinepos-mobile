/** «احذف حسابي»: explain, confirm, SMS step-up, then the server and this phone erase everything. */
import { useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  Screen,
  Text,
  Card,
  Banner,
  Button,
  IconBadge,
  colors,
  fonts,
} from "../../ui";
import { StepUpCode } from "../../features/auth/StepUpCode";
import { accessToken } from "../../lib/session";
import { errorMessage } from "../../lib/errors";
import { deleteAccountEverywhere } from "../../features/account/deleteAccount";
import { boot } from "../../state/boot";
import { useApp } from "../../state/app";

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const business = useApp((s) => s.business);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = () =>
    Alert.alert(
      t("deleteAccount.confirmTitle"),
      t("deleteAccount.confirmBody", { name: business?.name ?? "" }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("deleteAccount.confirmGo"),
          style: "destructive",
          onPress: () => {
            setErr(null);
            accessToken().then(setToken, (e) => setErr(errorMessage(t, e)));
          },
        },
      ],
    );

  const erase = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await deleteAccountEverywhere(await accessToken());
      await boot(); // empty phone → welcome screen
      router.replace("/");
    } catch (e) {
      setErr(errorMessage(t, e));
      setBusy(false);
    }
  };

  const items = ["shop", "backups", "devices", "phone"] as const;
  return (
    <Screen back title={t("deleteAccount.title")}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <IconBadge name="trash" hue="rose" size={44} />
          <Text
            style={{
              flex: 1,
              fontFamily: fonts.bold,
              fontSize: 16,
              lineHeight: 24,
              color: colors.ink.DEFAULT,
            }}
          >
            {t("deleteAccount.headline")}
          </Text>
        </View>
        <View style={{ gap: 6, marginTop: 12 }}>
          {items.map((k) => (
            <Text key={k} variant="body">
              • {t(`deleteAccount.what.${k}`)}
            </Text>
          ))}
        </View>
      </Card>
      <Banner
        tone="warn"
        text={t("deleteAccount.exportFirst")}
        action={t("deleteAccount.exportAction")}
        onAction={() => router.push("/settings/backup")}
      />
      {err ? <Banner tone="danger" text={err} /> : null}
      {token ? (
        busy ? (
          <Card>
            <Text variant="subtitle">{t("deleteAccount.working")}</Text>
          </Card>
        ) : (
          <>
            <Text variant="caption">{t("deleteAccount.codeHint")}</Text>
            <StepUpCode
              token={token}
              onVerified={erase}
              onCancel={() => setToken(null)}
            />
          </>
        )
      ) : (
        <Button
          testID="delete-account-start"
          kind="danger"
          icon="trash"
          title={t("deleteAccount.start")}
          onPress={start}
        />
      )}
    </Screen>
  );
}
