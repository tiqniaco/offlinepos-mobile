import { ltr, phoneLabel, signedText } from './format';

describe('phoneLabel', () => {
  it('shows Egyptian mobiles in the local form', () => {
    expect(phoneLabel('201012345678')).toBe('01012345678');
    expect(phoneLabel('+201512345678')).toBe('01512345678');
    expect(phoneLabel('01112345678')).toBe('01112345678');
  });
  it('Saudi mobiles local, anything else international', () => {
    expect(phoneLabel('966501234567')).toBe('0501234567');
    expect(phoneLabel('4915112345678')).toBe('+4915112345678');
    expect(phoneLabel(null)).toBe('');
  });
  it('isolates for RTL text on request', () => {
    expect(phoneLabel('201012345678', { isolate: true })).toBe('⁦01012345678⁩');
  });
});

describe('negative numbers in RTL', () => {
  it('isolates only values that start with a minus', () => {
    expect(signedText('-58.40')).toBe(ltr('-58.40'));
    expect(signedText('−3')).toBe(ltr('−3'));
    expect(signedText('58.40')).toBe('58.40');
  });
});
