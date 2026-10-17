import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { base64ToBytes } from '@noted/crypto';
import { randomUUID } from './uuid';

// The camera saves HEIC photos, which the editor page (Chromium) cannot decode. Android's own
// decoder turns them into a JPEG (at most 2560 px; the page compresses it further to WebP).
const MAX_SIDE = 2560;

export async function heicToJpegBase64(data: string): Promise<string> {
  const source = new File(Paths.cache, `heic-${randomUUID()}.heic`);
  source.write(base64ToBytes(data));
  try {
    let image = await ImageManipulator.manipulate(source.uri).renderAsync();
    const side = Math.max(image.width, image.height);
    if (side > MAX_SIDE) {
      const scale = MAX_SIDE / side;
      image = await ImageManipulator.manipulate(image).resize({ width: Math.round(image.width * scale), height: Math.round(image.height * scale) }).renderAsync();
    }
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
    try { new File(result.uri).delete(); } catch { /* cache, cleaned by the system */ }
    if (!result.base64) throw new Error('Cannot convert this HEIC photo');
    return result.base64;
  } finally {
    try { source.delete(); } catch { /* already gone */ }
  }
}
