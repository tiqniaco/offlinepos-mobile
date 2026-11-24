import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Sheet, ListGroup, ListRow, Chip } from '../../ui';
import { useCan } from './useInvCtx';
import { exportProductsToExcel } from './excel';
import { startCountFlow } from './countFlow';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';
import { useApprovalGate } from '../approval/useApprovalGate';
import type { Approval } from '../../domain/auth/approval';
import { getDb } from '../../db/client';
import { productListForExport } from '../../domain/inventory/import';
import { approveDataExport } from '../approval/exportGate';
import { exportReport } from '../export/actions';
import { productsListDoc } from '../export/lists';
import { bizHeader } from '../export/builders';

/** "⋯" menu of the products tab: everything that isn't "add" lives here (SPEC §10: no clutter). */
export function ProductsMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const manage = useCan('products.manage');
  const adjust = useCan('stock.adjust');
  const costView = useCan('cost.view');
  const [busy, setBusy] = useState(false);
  const gate = useApprovalGate();
  const go = (path: Parameters<typeof router.push>[0]) => {
    onClose();
    router.push(path);
  };
  const items = [
    manage && { key: 'quick', icon: 'camera' as const, hue: 'primary' as const, title: t('quickAdd.title'), onPress: () => go('/products/quick-add') },
    manage && { key: 'cat', icon: 'layers' as const, hue: 'amber' as const, title: t('products.categories'), onPress: () => go('/products/categories') },
    adjust && { key: 'count', icon: 'clipboard' as const, hue: 'sky' as const, title: t('products.stockCount'), onPress: () => (onClose(), void startCountFlow()) },
    adjust && { key: 'counts', icon: 'chart' as const, hue: 'sky' as const, title: t('countReport.title'), onPress: () => go('/products/counts') },
    manage && { key: 'import', icon: 'upload' as const, hue: 'primary' as const, title: t('products.import'), onPress: () => go('/products/import') },
    {
      key: 'export',
      icon: 'download' as const,
      hue: 'leaf' as const,
      title: busy ? t('common.loading') : t('products.export'),
      onPress: () => {
        if (busy) return;
        const doExport = async (approval: Approval | null) => {
          setBusy(true);
          try {
            await exportProductsToExcel(costView, approval);
          } catch (e) {
            toast(errorMessage(t, e), 'error');
          } finally {
            setBusy(false);
            onClose();
          }
        };
        // «تأكيد المدير»: the menu closes first (one sheet at a time).
        if (gate.needs('export')) {
          onClose();
          gate.run('export', (a) => doExport(a));
        } else void doExport(null);
      },
    },
    {
      key: 'pdf',
      icon: 'file' as const,
      hue: 'rose' as const,
      title: busy ? t('common.loading') : t('lists.productsPdf'),
      onPress: () => {
        if (busy) return;
        const doPdf = async (approval: Approval | null) => {
          setBusy(true);
          try {
            await approveDataExport('export', 'products_pdf', approval);
            await exportReport(productsListDoc(await productListForExport(getDb()), await bizHeader(), { includeCost: costView }), 'pdf');
          } catch (e) {
            toast(errorMessage(t, e), 'error');
          } finally {
            setBusy(false);
            onClose();
          }
        };
        // «تأكيد المدير»: the menu closes first (one sheet at a time).
        if (gate.needs('export')) {
          onClose();
          gate.run('export', (a) => doPdf(a));
        } else void doPdf(null);
      },
    },
    adjust && { key: 'check', icon: 'refresh' as const, hue: 'ink' as const, title: t('products.checkStock'), onPress: () => go('/products/check') },
  ].filter(Boolean) as { key: string; icon: 'layers'; hue: 'amber'; title: string; onPress: () => void }[];
  return (
    <>
      <Sheet visible={visible} onClose={onClose}>
        <ListGroup>
          {items.map((it, i) => (
            <ListRow key={it.key} icon={it.icon} hue={it.hue} title={it.title} onPress={it.onPress} last={i === items.length - 1} />
          ))}
        </ListGroup>
      </Sheet>
      {gate.sheet}
    </>
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
