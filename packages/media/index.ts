import imageCompression from 'browser-image-compression';

// Compressed image bytes (WebP, max 1920 px, about 1 MB) for an encrypted blob. GIFs are kept
// as they are so animations survive. No web worker: the library's worker loads its own code
// from a CDN, and nothing in the app may be fetched from the network that way.
export async function compressImageBytes(file: File): Promise<{ bytes: Uint8Array; type: string }> {
  if (file.type === 'image/gif') return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
  const compressed = await imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: false,
    fileType: 'image/webp',
    initialQuality: 0.8,
  });
  return { bytes: new Uint8Array(await compressed.arrayBuffer()), type: compressed.type || 'image/webp' };
}
