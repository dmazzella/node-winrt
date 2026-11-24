/**
 * Windows Native OCR on any image file (PNG, JPG, BMP, TIFF, WebP) — 100% pure WinRT.
 *
 * Zero Tesseract, zero GDI, zero C++: uses `StorageFile` -> `BitmapDecoder` -> `OcrEngine`.
 *
 * Generate projections once:
 *   npm run demo:ocr:gen
 *
 * Run on any image:
 *   node examples/ocr-image/index.ts path/to/screenshot.png
 */
import { resolve } from "node:path";
import { FileAccessMode, StorageFile } from "./winrt/Windows.Storage.ts";
import { BitmapDecoder } from "./winrt/Windows.Graphics.Imaging.ts";
import { OcrEngine } from "./winrt/Windows.Media.Ocr.ts";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node examples/ocr-image/index.ts <path-to-image.png|jpg|bmp>");
  process.exit(1);
}

const absPath = resolve(inputPath);
const t0 = performance.now();

using engine = OcrEngine.tryCreateFromUserProfileLanguages();
if (!engine) throw new Error("No Windows OCR language pack installed for the current user profile.");

using file = await StorageFile.getFileFromPathAsync(absPath);
if (!file) throw new Error(`File not found: ${absPath}`);

using stream = await file.openAsync(FileAccessMode.Read);
using decoder = await BitmapDecoder.createAsync(stream);
if (!decoder) throw new Error(`Unsupported image format: ${absPath}`);

using bitmap = await decoder.getSoftwareBitmapAsync();
if (!bitmap) throw new Error("Failed to decode SoftwareBitmap");

using result = await engine.recognizeAsync(bitmap);
if (!result) throw new Error("OCR failed");

const elapsedMs = Math.round(performance.now() - t0);
console.log(`File:   ${absPath}`);
console.log(`Size:   ${bitmap.pixelWidth}x${bitmap.pixelHeight} (OCR in ${elapsedMs} ms)`);
console.log(`Angle:  ${result.textAngle ?? 0} deg`);
console.log(`Text:\n${result.text}\n`);

const lines = result.lines;
for (let i = 0; i < lines.length; i++) {
  using line = lines[i];
  const words = line.words;
  const boxes = words.map((w) => {
    using word = w;
    const r = word.boundingRect;
    return `${word.text}@(${Math.round(r.X)},${Math.round(r.Y)},${Math.round(r.Width)}x${Math.round(r.Height)})`;
  });
  console.log(`Line ${i + 1}: ${boxes.join("  ")}`);
}
