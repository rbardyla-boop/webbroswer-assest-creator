export async function thumbnailFromImageBlob(blob, { size = 96 } = {}) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#111815";
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL("image/webp", 0.72);
  } finally {
    bitmap.close?.();
  }
}

export function iconThumbnail(label, color = "#7fdca0") {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#121815";
  ctx.fillRect(0, 0, 96, 96);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 60, 60);
  ctx.fillStyle = color;
  ctx.font = "12px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label).slice(0, 8).toUpperCase(), 48, 48);
  return canvas.toDataURL("image/webp", 0.72);
}
