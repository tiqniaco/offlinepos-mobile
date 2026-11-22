import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Sheet, ListGroup, ListRow, Chip } from '../../ui';
import { useCan } from './useInvCtx';
import { exportProductsToExcel } from './excel';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';

/** "⋯" menu of the products tab: everything that isn't "add" lives here (SPEC §10: no clutter). */
export function ProductsMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const manage = useCan('products.manage');
  const adjust = useCan('stock.adjust');
  const costView = useCan('cost.view');
  const [busy, setBusy] = useState(false);
  const go = (path: Parameters<typeof router.push>[0]) => {
    onClose();
    router.push(path);
  };
  const items = [
    manage && { key: 'cat', icon: 'layers' as const, hue: 'amber' as const, title: t('products.categories'), onPress: () => go('/products/categories') },
    adjust && { key: 'count', icon: 'clipboard' as const, hue: 'sky' as const, title: t('products.stockCount'), onPress: () => go('/products/count') },
    manage && { key: 'import', icon: 'upload' as const, hue: 'primary' as const, title: t('products.import'), onPress: () => go('/products/import') },
    {
      key: 'export',
      icon: 'download' as const,
      hue: 'leaf' as const,
      title: busy ? t('common.loading') : t('products.export'),
      onPress: async () => {
        setBusy(true);
        try {
          await exportProductsToExcel(costView);
        } catch (e) {
          toast(errorMessage(t, e), 'error');
        } finally {
          setBusy(false);
          onClose();
        }
      },
    },
    adjust && { key: 'check', icon: 'refresh' as const, hue: 'ink' as const, title: t('products.checkStock'), onPress: () => go('/products/check') },
  ].filter(Boolean) as { key: string; icon: 'layers'; hue: 'amber'; title: string; onPress: () => void }[];
  return (
    <Sheet visible={visible} onClose={onClose}>
      <ListGroup>
        {items.map((it, i) => (
          <ListRow key={it.key} icon={it.icon} hue={it.hue} title={it.title} onPress={it.onPress} last={i === items.length - 1} />
        ))}
      </ListGroup>
    </Sheet>
  );
}

export function CategoryPickerSheet({
  visible,
  categories,
  onClose,
  onPick,
  selectedId,
}: {
  visible: boolean;
  categories: { id: string; name: string; color: string | null }[];
  onClose: () => void;
  onPick: (id: string | null) => void;
  selectedId?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('productForm.category')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip label={t('products.noCategory')} selected={selectedId === null} onPress={() => onPick(null)} />
        {categories.map((c) => (
          <Chip key={c.id} label={c.name} dot={c.color} selected={selectedId === c.id} onPress={() => onPick(c.id)} />
        ))}
      </View>
    </Sheet>
  );
}
