/**
 * DEV-ONLY design gallery for the web preview (`npx expo start --web`): renders the pure views with
 * sample data so designers can review screens without a phone. Not reachable on devices or in
 * release builds (route guard in _layout.tsx + Platform check here).
 */
import { useState } from 'react';
import { Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { LockView, type LockUser } from '../features/lock/LockView';
import { HomeView } from '../features/home/HomeView';
import { MoreView } from '../features/more/MoreView';
import { Banner } from '../ui';
import { dateLabel } from '../lib/format';

const USERS: LockUser[] = [
  { id: '1', name: 'أحمد', color: '#18A999', roleName: 'المالك', biometricEnabled: true },
  { id: '2', name: 'منى', color: '#F2A93B', roleName: 'مدير', biometricEnabled: false },
  { id: '3', name: 'كريم', color: '#3B82C4', roleName: 'كاشير', biometricEnabled: false },
];

export default function DevGallery() {
  const { view = 'home' } = useLocalSearchParams<{ view?: string }>();
  const [pin, setPin] = useState(view === 'lock-pin' ? '12' : '');
  if (Platform.OS !== 'web' || !__DEV__) return null;
  const noop = () => undefined;
  if (view === 'lock' || view === 'lock-pin')
    return (
      <LockView
        businessName="سوبر ماركت النور"
        users={USERS}
        selected={view === 'lock-pin' ? USERS[0]! : null}
        pin={pin}
        message={null}
        busy={false}
        bioAvailable
        onSelect={noop}
        onPin={setPin}
        onSubmit={noop}
        onBiometric={noop}
      />
    );
  if (view === 'more')
    return (
      <MoreView
        userName="أحمد"
        userColor="#18A999"
        roleName="المالك"
        businessName="سوبر ماركت النور"
        account={[
          { key: 'u', icon: 'users', hue: 'amber', title: 'المستخدمين والصلاحيات', onPress: noop },
          { key: 's', icon: 'card', hue: 'teal', title: 'الاشتراك', value: 'احترافي', onPress: noop },
          { key: 'a', icon: 'list', hue: 'ink', title: 'سجل العمليات', onPress: noop },
        ]}
        app={[
          { key: 'sec', icon: 'shield', hue: 'sky', title: 'القفل والأمان', value: '5 دقيقة', onPress: noop },
          { key: 'l', icon: 'globe', hue: 'leaf', title: 'اللغة', value: 'العربية', onPress: noop },
        ]}
        onLock={noop}
        footer="دفترك 0.1.0 · عن التطبيق · A"
      />
    );
  return (
    <HomeView
      greeting="صباح الخير يا أحمد"
      userName="أحمد"
      userColor="#F2A93B"
      businessName="سوبر ماركت النور"
      dateLabel={dateLabel('ar')}
      planChip="فترة تجربة: فاضل 12 يوم"
      banner={view === 'home-banner' ? <Banner tone="warn" text="اشتراكك خلص. فاضل 4 يوم قبل ما ترجع للباقة المجانية." /> : null}
      tasks={[
        { key: 'o', title: 'حساب المالك اتعمل', icon: 'users', hue: 'teal', done: true },
        { key: 't', title: 'أضف موظفينك برقم سري لكل واحد', icon: 'users', hue: 'amber', done: false, onPress: noop },
        { key: 'l', title: 'فعّل الفتح بالبصمة', icon: 'fingerprint', hue: 'sky', done: false, onPress: noop },
        { key: 'p', title: 'أضف منتجاتك', icon: 'list', hue: 'rose', done: false, soon: true },
      ]}
      onLock={noop}
    />
  );
}
