import { composeDashboard } from './dashboard-art';
import type { AccentFrame } from './accent';
// Small vector wordmark: no webfont downloads and no full-screen image frames.
const letters = [
  'M0 20L6 0L12 20M3 12H9', // A
  'M0 0V20H12', // L
  'M0 20V0H12M0 9H9', // F
  'M0 20V0H9L12 3V7L9 10H0M7 10L13 20', // R
  'M12 0H0V20H12M0 9H9', // E
  'M0 0H7L12 5V15L7 20H0Z', // D
];
export function drawStartup(c: CanvasRenderingContext2D, frame: AccentFrame) {
  if (frame === 'blank') return;
  c.save();
  c.strokeStyle = frame === 'outline' ? '#555' : '#888';
  c.lineWidth = 1.25;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const count = 6;
  // Full wordmark is readable throughout; reveal the brackets and signature.
  c.save();
  c.translate(84, -32);
  c.scale(0.9, 0.9);
  c.stroke(
    new Path2D(
      'M12 13C8 3 28 3 24 13M12 12v5c0 8 12 8 12 0v-5M10 24l-6 6v5h28v-5l-6-6M12 24l6 11 6-11',
    ),
  );
  c.restore();
  for (let i = 0; i < count; i++) {
    c.save();
    c.translate(30 + i * 24, 20);
    c.stroke(new Path2D(letters[i]));
    c.restore();
  }
  c.strokeStyle = '#444';
  c.beginPath();
  c.moveTo(18, 16);
  c.lineTo(18, 10);
  c.lineTo(28, 10);
  c.moveTo(172, 10);
  c.lineTo(182, 10);
  c.lineTo(182, 16);
  c.moveTo(18, 47);
  c.lineTo(18, 53);
  c.lineTo(28, 53);
  c.moveTo(172, 53);
  c.lineTo(182, 53);
  c.lineTo(182, 47);
  c.stroke();
  c.fillStyle = '#777';
  c.fillRect(30, 65, (frame === 'outline' ? 0.25 : frame === 'arrival' ? 0.65 : 1) * 132, 1);
  c.restore();
}
const cache = new Map<
  AccentFrame,
  {
    key: string;
    panel: Uint8Array<ArrayBuffer>;
    solar: Uint8Array<ArrayBuffer>;
    tiles: ReturnType<typeof composeDashboard>;
  }
>();
export function startupAssets(frame: AccentFrame) {
  const found = cache.get(frame);
  if (found) return found;
  const tiles = composeDashboard((c) => {
    c.translate(112, 54);
    c.scale(1.6, 1.6);
    drawStartup(c, frame);
  });
  const value = { key: `startup-${frame}`, panel: tiles[0].bytes, solar: tiles[1].bytes, tiles };
  cache.set(frame, value);
  return value;
}
