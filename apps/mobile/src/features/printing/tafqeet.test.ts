import { amountInWordsAr, numberToArabicWords } from './tafqeet';

describe('تفقيط — amountInWordsAr (EGP)', () => {
  it.each([
    [0, 'صفر جنيه'],
    [100, 'جنيه واحد'],
    [200, 'جنيهان'],
    [300, 'ثلاثة جنيهات'],
    [1000, 'عشرة جنيهات'],
    [1100, 'أحد عشر جنيهاً'],
    [1200, 'اثنا عشر جنيهاً'],
    [2100, 'واحد وعشرون جنيهاً'],
    [10_000, 'مائة جنيه'],
    [10_500, 'مائة وخمسة جنيهات'],
    [25_000, 'مائتان وخمسون جنيهاً'],
    [100_000, 'ألف جنيه'],
    [200_000, 'ألفان جنيه'],
    [125_050, 'ألف ومائتان وخمسون جنيهاً وخمسون قرشاً'],
    [50, 'خمسون قرشاً'],
    [1, 'قرش واحد'],
    [5, 'خمسة قروش'],
    [300_000_000, 'ثلاثة ملايين جنيه'],
  ])('%i → %s', (minor, words) => {
    expect(amountInWordsAr(minor)).toBe(words);
  });

  it('whole numbers', () => {
    expect(numberToArabicWords(0)).toBe('صفر');
    expect(numberToArabicWords(1)).toBe('واحد');
    expect(numberToArabicWords(2)).toBe('اثنان');
    expect(numberToArabicWords(11)).toBe('أحد عشر');
    expect(numberToArabicWords(100)).toBe('مائة');
    expect(numberToArabicWords(1000)).toBe('ألف');
    expect(numberToArabicWords(3000)).toBe('ثلاثة آلاف');
    expect(numberToArabicWords(11_000)).toBe('أحد عشر ألفاً');
    expect(numberToArabicWords(150_000)).toBe('مائة وخمسون ألفاً');
    expect(numberToArabicWords(1_000_001)).toBe('مليون وواحد');
    expect(numberToArabicWords(999)).toBe('تسعمائة وتسعة وتسعون');
  });

  it('SAR keeps halalas as digits', () => {
    expect(amountInWordsAr(1050, 'SAR')).toBe('عشرة ريالات و50 هللة');
  });
});
