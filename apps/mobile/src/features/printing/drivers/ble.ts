/**
 * BLE printers (Android + iOS) via react-native-ble-plx. Most cheap BLE thermal printers expose one
 * writable characteristic; we try known printer services first, then any writable characteristic.
 */
import { Platform } from 'react-native';
import { chunkBytes } from '@daftarak/shared';
import { b64encode } from '../base64';
import { ensureBluetoothPermissions } from '../permissions';
import { PrintError, type FoundPrinter, type PrinterConfig, type PrinterDriver } from '../types';

/* eslint-disable @typescript-eslint/no-require-imports */
type BleManagerT = import('react-native-ble-plx').BleManager;
type DeviceT = import('react-native-ble-plx').Device;
let manager: BleManagerT | null = null;
const mgr = (): BleManagerT => {
  if (!manager) {
    const { BleManager } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    manager = new BleManager();
  }
  return manager;
};

/** Known (service, characteristic) pairs used by common Chinese/Xprinter/Rongta/Goojprt BLE printers. */
const KNOWN: [string, string][] = [
  ['000018f0-0000-1000-8000-00805f9b34fb', '00002af1-0000-1000-8000-00805f9b34fb'],
  ['e7810a71-73ae-499d-8c15-faa9aef0c3f2', 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f'],
  ['49535343-fe7d-4ae5-8fa9-9fafd205e455', '49535343-8841-43f4-a8d4-ecbe34729bb3'],
  ['0000ff00-0000-1000-8000-00805f9b34fb', '0000ff02-0000-1000-8000-00805f9b34fb'],
];

let connected: { device: DeviceT; service: string; char: string; withResponse: boolean; mtu: number } | null = null;

async function connect(address: string) {
  if (connected && connected.device.id === address && (await connected.device.isConnected())) return connected;
  const state = await mgr().state();
  if (state === 'PoweredOff') throw new PrintError('bluetooth_off');
  let device: DeviceT;
  try {
    device = await mgr().connectToDevice(address, { timeout: 8000, ...(Platform.OS === 'android' ? { requestMTU: 185 } : {}) });
    device = await device.discoverAllServicesAndCharacteristics();
  } catch {
    throw new PrintError('connect');
  }
  const services = await device.services();
  let pick: { service: string; char: string; withResponse: boolean } | null = null;
  for (const [s, c] of KNOWN) {
    if (!services.some((x) => x.uuid.toLowerCase() === s)) continue;
    const chars = await device.characteristicsForService(s);
    const ch = chars.find((x) => x.uuid.toLowerCase() === c);
    if (ch && (ch.isWritableWithoutResponse || ch.isWritableWithResponse)) {
      pick = { service: s, char: ch.uuid, withResponse: !ch.isWritableWithoutResponse };
      break;
    }
  }
  if (!pick) {
    for (const s of services) {
      const ch = (await device.characteristicsForService(s.uuid)).find((x) => x.isWritableWithoutResponse || x.isWritableWithResponse);
      if (ch) {
        pick = { service: s.uuid, char: ch.uuid, withResponse: !ch.isWritableWithoutResponse };
        break;
      }
    }
  }
  if (!pick) throw new PrintError('unsupported');
  connected = { device, ...pick, mtu: device.mtu || 23 };
  return connected;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const bleDriver: PrinterDriver = {
  kind: 'ble',
  async available() {
    return true;
  },
  async scan(onFound: (p: FoundPrinter) => void, ms = 8000) {
    await ensureBluetoothPermissions();
    const seen = new Set<string>();
    await mgr().startDeviceScan(null, { allowDuplicates: false }, (err, d) => {
      if (err || !d) return;
      const name = d.name ?? d.localName;
      if (!name || seen.has(d.id)) return;
      seen.add(d.id);
      onFound({ driver: 'ble', address: d.id, name, rssi: d.rssi });
    });
    await sleep(ms);
    mgr().stopDeviceScan();
  },
  stopScan() {
    manager?.stopDeviceScan();
  },
  async write(cfg: PrinterConfig, bytes: Uint8Array) {
    await ensureBluetoothPermissions();
    const c = await connect(cfg.address);
    const size = Math.max(20, Math.min(180, c.mtu - 3));
    try {
      for (const part of chunkBytes(bytes, size)) {
        const v = b64encode(part);
        if (c.withResponse) await c.device.writeCharacteristicWithResponseForService(c.service, c.char, v);
        else {
          await c.device.writeCharacteristicWithoutResponseForService(c.service, c.char, v);
          await sleep(8); // pacing: cheap printers drop data if flooded
        }
      }
    } catch {
      connected = null;
      throw new PrintError('write');
    }
  },
  async disconnect() {
    if (connected) await connected.device.cancelConnection().catch(() => undefined);
    connected = null;
  },
};
