import { useTranslation } from 'react-i18next';
import { Screen } from '../../ui';
import { NoScreenshots } from '../../features/NoScreenshots';
import { RestoreFromFile } from '../../features/backup/RestoreFromFile';

/** Existing shop (only while it has no documents): restore its ".kashiro" file on this phone. */
export default function RestoreFileInApp() {
  const { t } = useTranslation();
  return (
    <RestoreFromFile
      inApp
      Shell={({ footer, children }) => (
        <Screen back title={t('portable.restoreTitle')} subtitle={t('portable.restoreSubtitle')} footer={footer}>
          <NoScreenshots id="restore-file" />
          {children}
        </Screen>
      )}
    />
  );
}
