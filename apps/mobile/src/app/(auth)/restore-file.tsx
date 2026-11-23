import { useTranslation } from 'react-i18next';
import { OnboardingScreen } from '../../ui';
import { RestoreFromFile } from '../../features/backup/RestoreFromFile';

/** Fresh install: restore the shop from its own ".kashiro" file — no internet, no server. */
export default function RestoreFile() {
  const { t } = useTranslation();
  return (
    <RestoreFromFile
      inApp={false}
      Shell={({ footer, children }) => (
        <OnboardingScreen title={t('portable.restoreTitle')} subtitle={t('portable.restoreSubtitle')} footer={footer}>
          {children}
        </OnboardingScreen>
      )}
    />
  );
}
