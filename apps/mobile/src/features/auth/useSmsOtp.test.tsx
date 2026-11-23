import { Platform } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { useSmsOtp } from './useSmsOtp';

type Listener = (e: { code: string }) => void;
const mockListeners: Listener[] = [];
const mockNative = {
  start: jest.fn(async () => {}),
  stop: jest.fn(),
};
jest.mock('../../../modules/sms-consent', () => ({
  isSmsConsentAvailable: true,
  startSmsConsent: () => mockNative.start(),
  stopSmsConsent: () => mockNative.stop(),
  addSmsCodeListener: (l: Listener) => {
    mockListeners.push(l);
    return { remove: () => mockListeners.splice(mockListeners.indexOf(l), 1) };
  },
}));

const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
afterAll(() => setOS(realOS));

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.length = 0;
});

test('android: starts on mount, delivers codes to the latest callback, restarts, cleans up', async () => {
  setOS('android');
  const first = jest.fn();
  const second = jest.fn();
  const { result, rerender, unmount } = await renderHook(({ cb, on }: { cb: (c: string) => void; on: boolean }) => useSmsOtp(cb, on), {
    initialProps: { cb: first, on: true },
  });
  expect(result.current.supported).toBe(true);
  expect(mockNative.start).toHaveBeenCalledTimes(1);
  expect(mockListeners).toHaveLength(1);

  await rerender({ cb: second, on: true });
  mockListeners.forEach((l) => l({ code: '123456' }));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith('123456');

  result.current.restart();
  expect(mockNative.start).toHaveBeenCalledTimes(2);

  await rerender({ cb: second, on: false });
  expect(mockNative.stop).toHaveBeenCalled();
  expect(result.current.supported).toBe(false);
  expect(mockListeners).toHaveLength(1); // still listening: a sheet the user already saw can still deliver

  await unmount();
  expect(mockListeners).toHaveLength(0);
});

test('android: a failing start (no Play services) is swallowed', async () => {
  setOS('android');
  mockNative.start.mockRejectedValueOnce(new Error('no gms'));
  await renderHook(() => useSmsOtp(jest.fn()));
  expect(mockNative.start).toHaveBeenCalledTimes(1);
});

test('ios: no-op', async () => {
  setOS('ios');
  const { result } = await renderHook(() => useSmsOtp(jest.fn()));
  result.current.restart();
  expect(result.current.supported).toBe(false);
  expect(mockNative.start).not.toHaveBeenCalled();
  expect(mockListeners).toHaveLength(0);
});
