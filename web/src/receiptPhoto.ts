// A receipt's photo, shrunk in the browser before it goes anywhere (#707).

/** The size a photo is drawn at: its long side at most max, never enlarged. */
export function fitWithin(width: number, height: number, max = 1600) {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/**
 * The photo as a JPEG of at most 1600 px on its long side. Drawing it anew
 * drops its EXIF, the place it was taken included.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  // A transparent PNG would turn black in a JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no photo"))), "image/jpeg", 0.85),
  );
}
