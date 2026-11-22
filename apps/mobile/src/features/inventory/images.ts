/** Product photos: resized/compressed on the phone and kept in the app's private documents folder. */
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';

const DIR = 'product-images';

export async function saveProductImage(sourceUri: string, id: string): Promise<string> {
  const small = await manipulateAsync(sourceUri, [{ resize: { width: 600 } }], { compress: 0.7, format: SaveFormat.JPEG });
  const dir = new Directory(Paths.document, DIR);
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  const dest = new File(dir, `${id}.jpg`);
  if (dest.exists) dest.delete();
  new File(small.uri).copy(dest);
  return dest.uri;
}
