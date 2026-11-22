/**
 * Off-screen renderer for print jobs (mounted once in the root layout).
 * Pipeline (PLAN.md §10): ReceiptView (dots wide) → react-native-view-shot PNG (exact dot width) →
 * fast-png decode → RGBA → 1-bit → ESC/POS GS v 0 → printer driver.
 */
import { useEffect, useRef, type ComponentRef } from 'react';
import { View } from 'react-native';
import { create } from 'zustand';
import { captureRef } from 'react-native-view-shot';
import { decode } from 'fast-png';
import { buildReceiptBytes } from '@daftarak/shared';
import { ReceiptView } from './ReceiptView';
import { b64decode } from './base64';
import type { ReceiptData } from './receiptData';
import { PrintError } from './types';

interface Job {
  id: number;
  data: ReceiptData;
  dots: number;
  openDrawer: boolean;
  resolve: (bytes: Uint8Array) => void;
  reject: (e: unknown) => void;
}

const useJobs = create<{ job: Job | null }>(() => ({ job: null }));
let seq = 0;
let chain: Promise<unknown> = Promise.resolve();

/** Render a receipt to ESC/POS bytes (queued: one render at a time). */
export function renderReceiptBytes(data: ReceiptData, dots: number, openDrawer: boolean): Promise<Uint8Array> {
  const run = () =>
    new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        useJobs.setState({ job: null });
        reject(new PrintError('render'));
      }, 15_000);
      useJobs.setState({
        job: {
          id: ++seq,
          data,
          dots,
          openDrawer,
          resolve: (b) => {
            clearTimeout(timer);
            resolve(b);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        },
      });
    });
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/** RGBA from a decoded PNG (handles RGB / gray / alpha variants). */
function toRgba(png: ReturnType<typeof decode>): Uint8Array {
  const { width, height, channels } = png;
  const src = png.data as Uint8Array;
  if (channels === 4) return src;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = channels >= 3 ? src[i * channels]! : src[i * channels]!;
    const g = channels >= 3 ? src[i * channels + 1]! : r;
    const b = channels >= 3 ? src[i * channels + 2]! : r;
    const a = channels === 2 ? src[i * 2 + 1]! : 255;
    out.set([r, g, b, a], i * 4);
  }
  return out;
}

export function PrintHost() {
  const job = useJobs((s) => s.job);
  const ref = useRef<ComponentRef<typeof View>>(null);
  const done = useRef<number>(0);

  useEffect(() => {
    if (!job) return;
    // Give images / the QR SVG a moment to paint before capturing.
    const h = setTimeout(async () => {
      if (done.current === job.id) return;
      done.current = job.id;
      try {
        const b64 = await captureRef(ref, { format: 'png', result: 'base64', width: job.dots });
        const png = decode(b64decode(b64));
        const bytes = buildReceiptBytes({ rgba: toRgba(png), width: png.width, height: png.height, mode: 'threshold', openDrawer: job.openDrawer });
        job.resolve(bytes);
      } catch (e) {
        job.reject(e instanceof PrintError ? e : new PrintError('render'));
      } finally {
        useJobs.setState({ job: null });
      }
    }, 250);
    return () => clearTimeout(h);
  }, [job]);

  if (!job) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: -20000, top: 0 }}>
      <View ref={ref} collapsable={false}>
        <ReceiptView d={job.data} dots={job.dots} />
      </View>
    </View>
  );
}
