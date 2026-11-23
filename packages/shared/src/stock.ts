/**
 * Stock ledger math (PLAN.md §6). Pure functions used both by the incremental cache update
 * (in the posting transaction) and by the full rebuild from the ledger — so both always agree.
 *
 * Units: quantities in milli-units of the product's BASE unit; money in minor units;
 * avg cost is per ONE base unit (minor units).
 */
import { assertInt, mulDivRound, QTY_ONE } from './money';

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE',
  'PURCHASE_RETURN',
  'SALE',
  'SALE_RETURN',
  'ADJUST',
  'COUNT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'VOID_REVERSAL',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface StockLevel {
  qtyMilli: number;
  /** Moving-average cost per one base unit, minor units. */
  avgCostMinor: number;
  /** qty × avg, minor units (rounded). */
  valueMinor: number;
}

export const EMPTY_LEVEL: StockLevel = { qtyMilli: 0, avgCostMinor: 0, valueMinor: 0 };

export interface MovementInput {
  qtyMilli: number;
  /**
   * Cost per base unit for INBOUND movements that bring their own cost (opening, purchase, sale return).
   * null = "use the current average" (adjustments, counts, outbound).
   */
  unitCostMinor: number | null;
}

function valueOf(qtyMilli: number, avg: number): number {
  return mulDivRound(qtyMilli, avg, QTY_ONE);
}

export interface AppliedMovement {
  level: StockLevel;
  /** Unit cost the movement is valued at (stored on the movement row). */
  unitCostMinor: number;
  /** The movement's own value (signed): qty × unit cost (an outbound movement that empties the stock takes exactly the remaining value). */
  valueMinor: number;
  /**
   * Value correction on top of the movement's own value: non-zero only when an inbound movement with its own cost
   * arrives while stock is zero/negative (the average resets, so units sold "below zero" are re-valued at the new cost,
   * and any rounding residue left at zero is cleared). Invariant: level.value − old.value = valueMinor + trueUpMinor.
   * Callers post it (COGS / stock adjustment) so the journal INVENTORY account always equals Σ stock values.
   */
  trueUpMinor: number;
}

/**
 * Apply one movement to a level (moving weighted average). The stock VALUE is kept exact (old value + movement value),
 * the average is derived from it, so the stock value never drifts from the sum of the posted movement values:
 * - inbound with cost, stock > 0: value += qty × cost; avg = value / qty
 * - inbound with cost, stock ≤ 0: avg resets to the inbound cost; value = qty × cost (difference = trueUpMinor)
 * - inbound without cost / outbound: avg unchanged, valued at the average; emptying the stock takes the exact value
 */
export function applyMovement(level: StockLevel, m: MovementInput, fallbackCostMinor = 0): AppliedMovement {
  assertInt(m.qtyMilli, 'qtyMilli');
  const qty = level.qtyMilli + m.qtyMilli;
  if (m.qtyMilli > 0 && m.unitCostMinor != null) {
    assertInt(m.unitCostMinor, 'unitCostMinor');
    const mvValue = valueOf(m.qtyMilli, m.unitCostMinor);
    if (level.qtyMilli <= 0) {
      const value = valueOf(qty, m.unitCostMinor);
      return { level: { qtyMilli: qty, avgCostMinor: m.unitCostMinor, valueMinor: value }, unitCostMinor: m.unitCostMinor, valueMinor: mvValue, trueUpMinor: value - level.valueMinor - mvValue };
    }
    const value = level.valueMinor + mvValue;
    const avg = Math.max(0, mulDivRound(value, QTY_ONE, qty));
    return { level: { qtyMilli: qty, avgCostMinor: avg, valueMinor: value }, unitCostMinor: m.unitCostMinor, valueMinor: mvValue, trueUpMinor: 0 };
  }
  const avg = level.avgCostMinor > 0 ? level.avgCostMinor : fallbackCostMinor;
  const mvValue = qty === 0 ? -level.valueMinor : valueOf(m.qtyMilli, avg);
  return { level: { qtyMilli: qty, avgCostMinor: avg, valueMinor: level.valueMinor + mvValue }, unitCostMinor: avg, valueMinor: mvValue, trueUpMinor: 0 };
}

/** Replay a whole ledger (in order) from zero. Used by the rebuild and by tests. */
export function replayLedger(movements: readonly (MovementInput & { fallbackCostMinor?: number })[]): StockLevel {
  let level = EMPTY_LEVEL;
  for (const m of movements) level = applyMovement(level, m, m.fallbackCostMinor ?? 0).level;
  return level;
}

/** Quantity in a sale/purchase unit → base-unit milli quantity. factorMilli = base units per unit × 1000. */
export function toBaseQty(qtyMilli: number, factorMilli: number): number {
  return mulDivRound(qtyMilli, factorMilli, QTY_ONE);
}

/** Base-unit quantity expressed in a larger unit: { whole larger units, remaining base milli }. */
export function splitByUnit(baseQtyMilli: number, factorMilli: number): { units: number; remainderMilli: number } {
  if (factorMilli <= 0) throw new Error('factor must be > 0');
  const sign = baseQtyMilli < 0 ? -1 : 1;
  const abs = Math.abs(baseQtyMilli);
  const units = Math.floor(abs / factorMilli);
  const remainderMilli = abs - units * factorMilli;
  return { units: units * sign || 0, remainderMilli: remainderMilli * sign || 0 };
}

/** Sign of quantity by movement type, used to validate inputs. 0 = either. */
export function movementDirection(t: MovementType): 1 | -1 | 0 {
  switch (t) {
    case 'OPENING':
    case 'PURCHASE':
    case 'SALE_RETURN':
    case 'TRANSFER_IN':
      return 1;
    case 'SALE':
    case 'PURCHASE_RETURN':
    case 'TRANSFER_OUT':
      return -1;
    default:
      return 0;
  }
}

// ---- Barcodes ----

/** GS1 check digit for EAN-8/EAN-13/UPC-A/GTIN-14 (data digits without the check digit). */
export function gs1CheckDigit(data: string): number {
  if (!/^\d+$/.test(data)) throw new Error('digits only');
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const digit = Number(data[data.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/**
 * In-store EAN-13 for products without a barcode. Prefix "2" is the GS1 range reserved for
 * restricted in-store use, so it never collides with real manufacturer codes.
 * Format: 2 + 2-digit device number + 9-digit sequence + check digit.
 */
export function internalBarcode(deviceNumber: number, seq: number): string {
  if (deviceNumber < 0 || deviceNumber > 99 || seq < 0 || seq > 999_999_999) throw new Error('out of range');
  const data = '2' + String(deviceNumber).padStart(2, '0') + String(seq).padStart(9, '0');
  return data + gs1CheckDigit(data);
}

/** Normalise scanner / keyboard input: trim, Latin digits, drop spaces. Keeps letters (Code128 can have them). */
export function normalizeBarcode(raw: string): string {
  let out = '';
  for (const ch of raw.trim()) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    else if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else if (!/\s/.test(ch)) out += ch;
  }
  return out;
}
