import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

// Brand icon: red rounded square + white location pin with "WK".
// `pad` reserves the safe area so the icon also works as a maskable icon.
function svg(size, { maskable = false } = {}) {
  const r = Math.round(size * 0.22);
  // Pin geometry scaled to canvas; tighter when maskable to stay in safe zone.
  const scale = maskable ? 0.62 : 0.72;
  const cx = size / 2;
  const pinW = size * scale;
  const pinH = size * scale;
  const px = cx - pinW / 2;
  const py = size * (maskable ? 0.16 : 0.12);
  const fontSize = Math.round(pinW * 0.34);
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E50405"/>
      <stop offset="1" stop-color="#B80002"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#g)"/>
  <g transform="translate(${px}, ${py})">
    <path d="M ${pinW / 2} 0
             C ${pinW * 0.18} 0 0 ${pinH * 0.2} 0 ${pinH * 0.42}
             C 0 ${pinH * 0.7} ${pinW * 0.32} ${pinH * 0.82} ${pinW / 2} ${pinH}
             C ${pinW * 0.68} ${pinH * 0.82} ${pinW} ${pinH * 0.7} ${pinW} ${pinH * 0.42}
             C ${pinW} ${pinH * 0.2} ${pinW * 0.82} 0 ${pinW / 2} 0 Z"
          fill="#FFFFFF"/>
    <circle cx="${pinW / 2}" cy="${pinH * 0.42}" r="${pinW * 0.27}" fill="#DB0002"/>
    <text x="${pinW / 2}" y="${pinH * 0.42}" text-anchor="middle" dominant-baseline="central"
          font-family="Arial, Helvetica, sans-serif" font-weight="700"
          font-size="${fontSize}" fill="#FFFFFF">WK</text>
  </g>
</svg>`);
}

async function gen() {
  await sharp(svg(192, { maskable: true })).png().toFile(path.join(publicDir, 'icon-192.png'));
  await sharp(svg(512, { maskable: true })).png().toFile(path.join(publicDir, 'icon-512.png'));
  await sharp(svg(180)).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
  await sharp(svg(32)).png().toFile(path.join(publicDir, 'favicon.ico'));
  console.log('Generated icon-192.png, icon-512.png, apple-touch-icon.png, favicon.ico');
}

gen().catch((e) => {
  console.error(e);
  process.exit(1);
});
