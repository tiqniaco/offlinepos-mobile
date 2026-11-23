/**
 * "Scan or upload the supplier's invoice" on the new-purchase screen. Needs internet (the rest of the purchase works
 * offline). Paid plans only (licence limit `ocr_month`); free plans get the upgrade sheet instead.
 * Photo / gallery images are downsized on the phone (long edge 1280 px, JPEG 0.6 ≈ 1.5k image tokens); PDFs are sent
 * as is (≤ 1.5 MB, ≤ 3 pages). The result goes to the review screen (/purchases/scan-review).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Network from 'expo-network';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { OCR_IMAGE_MAX_BYTES, OCR_PDF_MAX_PAGES, UNLIMITED, sha256Hex, type OcrMediaType } from '@daftarak/shared';
import { Sheet, Text, Button, Icon, IconBadge, colors, fonts, shadow, type IconName } from '../../ui';
import { Pressable } from '../../ui/Press';
import { api, ApiError } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { useApp } from '../../state/app';
import { useUpgrade } from '../../state/upgrade';
import { useOcrScan } from '../../state/ocrScan';
import { toast } from '../../state/toast';

type Source = 'camera' | 'gallery' | 'pdf';
const LONG_EDGE = 1280;

class ScanInputError extends Error {}

async function online(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return !!s.isConnected && s.isInternetReachable !== false;
  } catch {
    return true; // unknown: let the request decide
  }
}

/** Picks the file and returns base64 + media type, or null when the user cancelled. */
async function pickFile(source: Source, onCameraDenied: () => void): Promise<{ data: string; mediaType: OcrMediaType } | null> {
  if (source === 'pdf') {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return null;
    const a = r.assets[0];
    if (a.size != null && a.size > OCR_IMAGE_MAX_BYTES) throw new ScanInputError('pdf_too_large');
    const data = await new File(a.uri).base64();
    if ((data.length * 3) / 4 > OCR_IMAGE_MAX_BYTES) throw new ScanInputError('pdf_too_large');
    // Same cheap page count as the server ("/Type /Page" objects); 0 = compressed, let the server decide by size.
    try {
      const pages = (atob(data).match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
      if (pages > OCR_PDF_MAX_PAGES) throw new ScanInputError('pdf_too_large');
    } catch (e) {
      if (e instanceof ScanInputError) throw e;
    }
    return { data, mediaType: 'application/pdf' };
  }
  let useCamera = source === 'camera';
  if (useCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      onCameraDenied();
      useCamera = false; // fall back to the gallery
    }
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const r = useCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  const landscape = (a.width || 0) >= (a.height || 0);
  const resize = landscape ? { width: Math.min(a.width || LONG_EDGE, LONG_EDGE) } : { height: Math.min(a.height || LONG_EDGE, LONG_EDGE) };
  const small = await manipulateAsync(a.uri, [{ resize }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!small.base64) throw new Error('no_base64');
  if ((small.base64.length * 3) / 4 > OCR_IMAGE_MAX_BYTES) throw new ScanInputError('image_invalid');
  return { data: small.base64, mediaType: 'image/jpeg' };
}

export function ScanInvoiceButton() {
  const { t } = useTranslation();
  const business = useApp((s) => s.business);
  const ocrLimit = useApp((s) => s.licence?.limits.ocr_month ?? 0);
  const [usedCount, setUsedCount] = useState<number | null>(null);
  const [serverLimit, setServerLimit] = useState<number | null>(null);
  const [choose, setChoose] = useState(false);
  const [offlineFor, setOfflineFor] = useState<Source | null>(null);
  const [reading, setReading] = useState(false);
  const inFlight = useRef(false);
  /** «إلغاء» on the reading overlay aborts the request (nothing is saved; the scan may still count server-side). */
  const abort = useRef<AbortController | null>(null);
  const bid = business?.serverBusinessId;

  useEffect(() => {
    if (!bid || ocrLimit === 0) return;
    let alive = true;
    // Best effort: the remaining-scans hint. Offline or any error → no hint.
    void (async () => {
      try {
        if (!(await online())) return;
        const u = await api.scanUsage(await accessToken(), bid);
        if (alive) {
          setUsedCount(u.used);
          setServerLimit(u.limit);
        }
      } catch {
        /* hint only */
      }
    })();
    return () => {
      alive = false;
    };
  }, [bid, ocrLimit]);

  const run = useCallback(
    async (source: Source) => {
      if (inFlight.current || !bid) return;
      inFlight.current = true;
      setOfflineFor(null);
      try {
        if (!(await online())) {
          setOfflineFor(source);
          return;
        }
        const file = await pickFile(source, () => toast(t('ocr.cameraDenied'), 'error'));
        if (!file) return;
        setReading(true);
        const ctrl = new AbortController();
        abort.current = ctrl;
        // Same file again (retry after a timeout / network drop) → same key → the stored result, not a second charge.
        const idempotencyKey = `scan-${sha256Hex(`${bid}|${file.data.length}|${file.data.slice(0, 65_536)}|${file.data.slice(-65_536)}`).slice(0, 40)}`;
        const r = await api.scanInvoice(await accessToken(), bid, file.data, file.mediaType, { signal: ctrl.signal, idempotencyKey });
        if (ctrl.signal.aborted) return;
        setUsedCount(r.used);
        setServerLimit(r.limit);
        if (!r.lines.length) {
          toast(t('ocr.none'), 'error');
          return;
        }
        useOcrScan.getState().set(r);
        router.push('/purchases/scan-review');
      } catch (e) {
        if (abort.current?.signal.aborted) return; // cancelled by the user: no error message
        if (e instanceof ScanInputError) toast(t(`errors.${e.message}`), 'error');
        else if (e instanceof ApiError && e.code === 'network') setOfflineFor(source);
        else if (e instanceof ApiError && e.code === 'ocr_quota_exceeded') {
          if (serverLimit != null) setUsedCount(serverLimit);
          useUpgrade.getState().show('ocrQuota');
        } else if (e instanceof ApiError && e.code === 'ocr_not_in_plan') useUpgrade.getState().show('ocr');
        else if (e instanceof ApiError && e.code === 'rate_limited') toast(t('ocr.rateLimited'), 'error');
        else toast(errorMessage(t, e), 'error');
      } finally {
        abort.current = null;
        setReading(false);
        inFlight.current = false;
      }
    },
    [bid, serverLimit, t],
  );

  const open = () => {
    if (inFlight.current) return;
    if (ocrLimit === 0) return useUpgrade.getState().show('ocr');
    setChoose(true);
  };
  const pickSource = (s: Source) => {
    setChoose(false);
    // Let the sheet close before the system picker opens.
    setTimeout(() => void run(s), 250);
  };

  const limit = serverLimit ?? ocrLimit;
  const left = limit === UNLIMITED ? null : usedCount != null ? Math.max(0, limit - usedCount) : null;
  const options: { s: Source; icon: IconName; label: string; hint?: string }[] = [
    { s: 'camera', icon: 'camera', label: t('ocr.camera') },
    { s: 'gallery', icon: 'image', label: t('ocr.gallery') },
    { s: 'pdf', icon: 'file', label: t('ocr.pdf'), hint: t('ocr.pdfHint') },
  ];

  return (
    <View style={{ gap: 4 }}>
      <Pressable
        testID="purchase-ocr-scan"
        accessibilityLabel={t('ocr.button')}
        onPress={open}
        disabled={reading}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200], opacity: pressed ? 0.85 : 1 }, shadow.soft]}
      >
        <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary[600] }}>
          <Icon name="camera" color="#FFFFFF" tint="rgba(255,255,255,0.2)" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.primary[800] }}>{t('ocr.button')}</Text>
          <Text style={{ fontSize: 12, lineHeight: 18, color: colors.ink.mute }}>
            {ocrLimit === 0 ? t('ocr.paidOnly') : left != null ? t('ocr.left', { n: left }) : limit === UNLIMITED ? t('ocr.leftUnlimited') : t('ocr.needsNet')}
          </Text>
        </View>
        <Icon name="chevron" size={16} color={colors.ink.faint} />
      </Pressable>
      {ocrLimit !== 0 && (left != null || limit === UNLIMITED) ? <Text style={{ fontSize: 11.5, lineHeight: 17, color: colors.ink.mute, paddingHorizontal: 4 }}>{t('ocr.needsNet')}</Text> : null}

      <Sheet visible={choose} onClose={() => setChoose(false)} title={t('ocr.chooseTitle')}>
        <Text variant="caption">{t('ocr.needsNet')}</Text>
        {options.map((o) => (
          <Pressable
            key={o.s}
            testID={`ocr-source-${o.s}`}
            onPress={() => pickSource(o.s)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: pressed ? colors.paper.sunk : colors.paper.card })}
          >
            <IconBadge name={o.icon} hue="primary" size={40} />
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{o.label}</Text>
              {o.hint ? <Text variant="caption">{o.hint}</Text> : null}
            </View>
          </Pressable>
        ))}
      </Sheet>

      <Sheet
        visible={offlineFor != null}
        onClose={() => setOfflineFor(null)}
        title={t('ocr.offlineTitle')}
        footer={
          <>
            <Button testID="ocr-offline-retry" icon="refresh" title={t('ocr.retry')} onPress={() => { const s = offlineFor; if (s) void run(s); }} />
            <Button kind="ghost" title={t('ocr.manual')} onPress={() => setOfflineFor(null)} />
          </>
        }
      >
        <View style={{ alignItems: 'center', gap: 8 }}>
          <IconBadge name="cloudOff" hue="amber" size={56} />
          <Text variant="body" style={{ textAlign: 'center' }}>{t('ocr.offline')}</Text>
        </View>
      </Sheet>

      <Modal visible={reading} transparent animationType="fade" statusBarTranslucent onRequestClose={() => abort.current?.abort()}>
        <View testID="ocr-reading" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, backgroundColor: 'rgba(15,23,42,0.78)' }}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={{ fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, color: '#FFFFFF', textAlign: 'center' }}>{t('ocr.reading')}</Text>
          <Text style={{ fontSize: 13.5, lineHeight: 20, color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>{t('ocr.readingHint')}</Text>
          <Button testID="ocr-cancel" kind="light" compact title={t('common.cancel')} onPress={() => abort.current?.abort()} />
        </View>
      </Modal>
    </View>
  );
}
