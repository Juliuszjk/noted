import { isHeicFile } from '@noted/editor';

// HEIC / HEIF photos (the phone's camera saves them) cannot be decoded by WebKitGTK. They are
// decoded with libheif (WebAssembly, loaded only when such a photo comes) into a JPEG that the
// normal image compression then turns into WebP.
let decoder: Promise<any> | null = null;
const libheif = () => {
  decoder ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => m.default());
  return decoder;
};

export async function heicToJpeg(file: File): Promise<File> {
  const lib = await libheif();
  const images = new lib.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  const image = images?.[0];
  if (!image) throw new Error('Cannot read this HEIC photo');
  try {
    const width = image.get_width();
    const height = image.get_height();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    const pixels = context.createImageData(width, height);
    await new Promise<void>((resolve, reject) =>
      image.display(pixels, (result: unknown) => (result ? resolve() : reject(new Error('Cannot decode this HEIC photo')))));
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('Cannot convert this HEIC photo');
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    for (const img of images) img.free?.();
  }
}

export const withoutHeic = (file: File): Promise<File> => (isHeicFile(file) ? heicToJpeg(file) : Promise.resolve(file));
