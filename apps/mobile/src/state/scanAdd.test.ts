import { useApp } from './app';
import { useScanAdd } from './scanAdd';
import type { SessionUser } from '../domain/auth/users';

const u = (id: string) => ({ id, name: id }) as unknown as SessionUser;
const pending = [{ key: 'k', productId: 'p', productUnitId: 'pu', name: 'شاي', unitName: 'قطعة', qtyMilli: 3000 }];

describe('scan-add pending list', () => {
  beforeEach(() => {
    useApp.setState({ status: 'ready', user: u('a') });
    useScanAdd.setState({ pending, added: ['شاي'], lastUnit: 'كرتونة', lastCategoryId: 'c1' });
  });

  it('is cleared when the app locks', () => {
    useApp.getState().lock();
    expect(useScanAdd.getState()).toMatchObject({ pending: [], added: [], lastUnit: 'قطعة', lastCategoryId: null });
  });

  it('is cleared when another user takes over', () => {
    useApp.getState().unlock(u('b'));
    expect(useScanAdd.getState().pending).toEqual([]);
  });

  it('survives unrelated app updates and the same user unlocking again', () => {
    useApp.getState().touch();
    useApp.getState().unlock(u('a'));
    expect(useScanAdd.getState().pending).toEqual(pending);
  });
});
