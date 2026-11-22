export type DriverKind = 'ble' | 'spp';

export interface PrinterConfig {
  driver: DriverKind;
  /** BLE device id or Classic MAC address. */
  address: string;
  name: string;
  paperWidth: 58 | 80;
  /** Printable dots across (384 for 58 mm, 576 for 80 mm; some 80 mm printers print 512). */
  dots: number;
  autoPrint: boolean;
  openDrawer: boolean;
  copies: number;
}

export interface FoundPrinter {
  driver: DriverKind;
  address: string;
  name: string;
  /** Already paired in Android settings (Classic). */
  paired?: boolean;
  rssi?: number | null;
}

/** Pluggable printer transport (SPEC §3: Sunmi and others plug in here later). */
export interface PrinterDriver {
  kind: DriverKind;
  available(): Promise<boolean>;
  scan(onFound: (p: FoundPrinter) => void, ms?: number): Promise<void>;
  stopScan(): void;
  write(cfg: PrinterConfig, bytes: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
}

export class PrintError extends Error {
  constructor(public readonly code: 'no_printer' | 'permission' | 'bluetooth_off' | 'connect' | 'write' | 'render' | 'unsupported') {
    super(code);
    this.name = 'PrintError';
  }
}
