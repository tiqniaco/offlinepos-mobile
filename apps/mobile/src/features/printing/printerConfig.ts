import { Platform } from 'react-native';
import { PAPER_DOTS } from '@daftarak/shared';
import { useApp } from '../../state/app';
import { bleDriver } from './drivers/ble';
import { sppDriver } from './drivers/spp';
import type { PrinterConfig, PrinterDriver } from './types';

export function currentPrinter(): PrinterConfig | null {
  return (useApp.getState().settings as { printer?: PrinterConfig | null }).printer ?? null;
}

export function driverFor(cfg: Pick<PrinterConfig, 'driver'>): PrinterDriver {
  return cfg.driver === 'spp' ? sppDriver : bleDriver;
}

/** Drivers offered on this platform: iOS = BLE only (SPEC §3). */
export function platformDrivers(): PrinterDriver[] {
  return Platform.OS === 'android' ? [sppDriver, bleDriver] : [bleDriver];
}

export function defaultDots(width: 58 | 80): number {
  return PAPER_DOTS[width];
}
