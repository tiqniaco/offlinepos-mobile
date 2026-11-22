/**
 * Bluetooth Classic (SPP / RFCOMM) printers — Android only (iOS doesn't allow SPP for non-MFi devices).
 * Uses react-native-bluetooth-classic behind the PrinterDriver interface; if that library can't build
 * on a future React Native, a small local Expo module can replace this file (PLAN.md R-03).
 */
import { Platform } from 'react-native';
import { chunkBytes } from '@daftarak/shared';
import { b64encode } from '../base64';
import { ensureBluetoothPermissions } from '../permissions';
import { PrintError, type FoundPrinter, type PrinterConfig, type PrinterDriver } from '../types';

/* eslint-disable @typescript-eslint/no-require-imports */
type RNBC = typeof import('react-native-bluetooth-classic').default;
const lib = (): RNBC => require('react-native-bluetooth-classic').default as RNBC;

let connectedAddress: string | null = null;
let cancelled = false;

export const sppDriver: PrinterDriver = {
  kind: 'spp',
  async available() {
    if (Platform.OS !== 'android') return false;
    try {
      return await lib().isBluetoothAvailable();
    } catch {
      return false;
    }
  },
  async scan(onFound: (p: FoundPrinter) => void) {
    await ensureBluetoothPermissions();
    const bt = lib();
    if (!(await bt.isBluetoothEnabled())) throw new PrintError('bluetooth_off');
    cancelled = false;
    // Paired devices first (most shops pair the printer once in Android settings).
    for (const d of await bt.getBondedDevices()) onFound({ driver: 'spp', address: d.address, name: d.name || d.address, paired: true });
    try {
      const found = await bt.startDiscovery();
      if (!cancelled) for (const d of found) onFound({ driver: 'spp', address: d.address, name: d.name || d.address, paired: false });
    } catch {
      // discovery can fail without location services on old Android; paired list is enough
    }
  },
  stopScan() {
    cancelled = true;
    void lib().cancelDiscovery().catch(() => undefined);
  },
  async write(cfg: PrinterConfig, bytes: Uint8Array) {
    await ensureBluetoothPermissions();
    const bt = lib();
    try {
      if (connectedAddress !== cfg.address || !(await bt.isDeviceConnected(cfg.address))) {
        await bt.connectToDevice(cfg.address, { delimiter: '', charset: 'ascii' } as never);
        connectedAddress = cfg.address;
      }
    } catch {
      connectedAddress = null;
      throw new PrintError('connect');
    }
    try {
      for (const part of chunkBytes(bytes, 2048)) await bt.writeToDevice(cfg.address, b64encode(part), 'base64' as never);
    } catch {
      connectedAddress = null;
      throw new PrintError('write');
    }
  },
  async disconnect() {
    if (connectedAddress) await lib().disconnectFromDevice(connectedAddress).catch(() => undefined);
    connectedAddress = null;
  },
};
