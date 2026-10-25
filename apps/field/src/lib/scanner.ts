/**
 * QR / barcode scanning with the browser's built-in BarcodeDetector (Chrome
 * on Android). No library, no network. Falls back to typing the code.
 */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export function scanSupported(): boolean {
  return typeof window !== "undefined" && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;
}

/** Start the camera in `video` and resolve with the first code seen. */
export async function scanOnce(video: HTMLVideoElement, signal: AbortSignal): Promise<string> {
  if (!scanSupported()) throw new Error("unsupported");
  const detector = new window.BarcodeDetector!({ formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "data_matrix"] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  video.srcObject = stream;
  await video.play();
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const codes = await detector.detect(video).catch(() => []);
      const value = codes.find((c) => c.rawValue)?.rawValue;
      if (value) return value;
      await new Promise((r) => setTimeout(r, 200));
    }
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}
