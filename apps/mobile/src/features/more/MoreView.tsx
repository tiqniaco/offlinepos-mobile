import { View } from 'react-native';
import { fonts } from '../../ui/fonts';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Card, Avatar, ListGroup, ListRow, SectionTitle, colors } from '../../ui';

export interface MoreItem {
  key: string;
  icon: Parameters<typeof ListRow>[0]['icon'];
  hue: Parameters<typeof ListRow>[0]['hue'];
  title: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
  testID?: string;
}

/** Pure view so it can be previewed in the dev gallery. Container: src/app/(main)/more.tsx */
export function MoreView({
  userName,
  userColor,
  roleName,
  businessName,
  account,
  app,
  onLock,
  footer,
}: {
  userName: string;
  userColor: string;
  roleName: string;
  businessName: string;
  account: MoreItem[];
  app: MoreItem[];
  onLock: () => void;
  footer: string;
}) {
  const { t } = useTranslation();
  const group = (items: MoreItem[]) => (
    <ListGroup>
      {items.map((it, i) => (
        <ListRow key={it.key} testID={it.testID} icon={it.icon} hue={it.hue} title={it.title} subtitle={it.subtitle} value={it.value} onPress={it.onPress} last={i === items.length - 1} />
      ))}
    </ListGroup>
  );
  return (
    <Screen title={t('more.title')}>
      <Card>
        <View className="flex-row items-center gap-3">
          <Avatar name={userName} color={userColor} size={56} />
          <View className="flex-1 gap-0.5">
            <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 27, color: colors.ink.DEFAULT }}>{userName}</Text>
            <Text variant="caption">{businessName}</Text>
          </View>
          <View style={{ backgroundColor: colors.primary[50], borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4 }}>
            <Text style={{ color: colors.primary[700], fontSize: 13, lineHeight: 20, fontFamily: fonts.bold }}>{roleName}</Text>
          </View>
        </View>
      </Card>
      {account.length ? (
        <>
          <SectionTitle>{t('more.sectionAccount')}</SectionTitle>
          {group(account)}
        </>
      ) : null}
      <SectionTitle>{t('more.sectionApp')}</SectionTitle>
      {group(app)}
      <ListGroup>
        <ListRow testID="lock-now" icon="lock" hue="rose" title={t('more.lockNow')} subtitle={t('more.lockHint')} onPress={onLock} last />
      </ListGroup>
      <Text variant="caption" className="pt-2 text-center">
        {footer}
      </Text>
    </Screen>
  );
}
