import { isEgyptianMobile } from './market';

test('Egyptian mobiles only', () => {
  expect(isEgyptianMobile('201558858884')).toBe(true);
  expect(isEgyptianMobile('201012345678')).toBe(true);
  expect(isEgyptianMobile('966501234567')).toBe(false);
  expect(isEgyptianMobile('201312345678')).toBe(false);
});
