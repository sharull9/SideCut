// Renders the raster brand assets from the SVG sources in public/brand.
// Run after changing a mark: `vp run --filter @sidecut/landing brand-assets`.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const pub = join(root, "public");
const brand = join(pub, "brand");
const fonts = join(root, "node_modules/@fontsource-variable");

const browser = await chromium.launch();
const scratch = await mkdtemp(join(tmpdir(), "raee-brand-"));

async function render(file, width, height, html) {
  const page = await browser.newPage({ viewport: { width, height } });
  const htmlPath = join(scratch, "render.html");
  await writeFile(htmlPath, html);
  await page.goto(pathToFileURL(htmlPath).href);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  if (file) await writeFile(join(pub, file), png);
  return png;
}

const svgPage = (svg, size) =>
  `<html><body style="margin:0"><img src="${pathToFileURL(join(brand, svg)).href}" width="${size}" height="${size}" style="display:block"></body></html>`;

const icon = (svg, size, file) => render(file, size, size, svgPage(svg, size));

// Tabs and bookmarks that cannot use favicon.svg get the opaque tile.
const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(icoSizes.map((size) => icon("app-icon.svg", size)));
await writeFile(join(pub, "favicon.ico"), ico(icoSizes, icoImages));

await icon("app-icon-square.svg", 180, "apple-touch-icon.png");
await icon("app-icon-square.svg", 192, "icon-192.png");
await icon("app-icon-square.svg", 512, "icon-512.png");

const font = (pkg, file) => pathToFileURL(join(fonts, pkg, "files", file)).href;
const mark = await readFile(join(brand, "mark.svg"), "utf8");
await render(
  "og.png",
  1200,
  630,
  `<html><head><style>
    @font-face { font-family: Geist; src: url(${font("geist", "geist-latin-wght-normal.woff2")}); font-weight: 100 900; }
    @font-face { font-family: GeistMono; src: url(${font("geist-mono", "geist-mono-latin-wght-normal.woff2")}); font-weight: 100 900; }
    body { margin: 0; width: 1200px; height: 630px; background: #fafaf9; font-family: Geist; color: #121210;
      background-image: radial-gradient(rgb(18 18 16 / 0.09) 1.5px, transparent 1.5px); background-size: 22px 22px;
      display: flex; align-items: center; gap: 56px; padding: 0 72px 0 88px; box-sizing: border-box; }
    .glow { position: absolute; inset: auto 0 0 0; height: 420px;
      background: radial-gradient(55% 100% at 76% 100%, rgb(0 155 68 / 0.2), transparent 70%); }
    .copy { position: relative; flex: 1; }
    .lockup { display: flex; align-items: center; gap: 20px; }
    .lockup svg { width: 84px; height: 84px; }
    .name { font-size: 80px; font-weight: 640; letter-spacing: -0.05em; }
    .tag { margin-top: 36px; font-size: 54px; line-height: 1.04; font-weight: 600; letter-spacing: -0.045em; }
    .tag em { font-style: normal; color: #00792f; }
    .eyebrow { margin-top: 28px; font-family: GeistMono; font-size: 17px; letter-spacing: 0.16em; color: #6b6b66; }
    .player { position: relative; width: 560px; flex: none; }
    .player svg { display: block; width: 100%; height: auto; overflow: visible; }
  </style></head><body>
    <div class="glow"></div>
    <div class="copy">
      <div class="lockup">${mark}<span class="name">raE.E</span></div>
      <div class="tag">From first take<br>to <em>final cut.</em></div>
      <div class="eyebrow">LOCAL-FIRST VIDEO EDITOR</div>
    </div>
    <div class="player">${livePlayer()}</div>
  </body></html>`,
);

await browser.close();
await rm(scratch, { recursive: true, force: true });

/** The hero's live player, frozen mid-playback. */
function livePlayer() {
  const ink = "#121210";
  const rec = "#e0412f";
  const mono = 'font-family="GeistMono"';
  const bars = [10, 16, 8, 13]
    .map(
      (h, i) =>
        `<rect x="${436 + i * 6}" y="${36 - h}" width="3.5" height="${h}" rx="1.75" fill="#009b44"/>`,
    )
    .join("");
  return `<svg viewBox="-4 -58 488 380" fill="none">
    <defs>
      <clipPath id="video"><rect x="10" y="10" width="460" height="214" rx="5"/></clipPath>
      <linearGradient id="shimmer" x1="0" x2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset="0.5" stop-color="#fff" stop-opacity="0.9"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="M330 0V-26H480" stroke="${ink}" stroke-opacity="0.55" stroke-width="0.9"/>
    <circle cx="330" cy="0" r="2.2" fill="${ink}"/>
    <text x="480" y="-35" text-anchor="end" ${mono} font-size="12" letter-spacing="1.6" fill="${ink}" fill-opacity="0.7">PLAYABLE LIVE</text>
    <rect x="0" y="0" width="480" height="270" rx="7" fill="#fff" stroke="${ink}" stroke-width="1.3"/>
    <g clip-path="url(#video)">
      <rect x="10" y="10" width="460" height="214" fill="#f1f1ee"/>
      <circle cx="240" cy="113" r="27" fill="#e3e3de" stroke="${ink}" stroke-opacity="0.25" stroke-width="0.8"/>
      <path d="M174 224q66-84 132 0z" fill="#e3e3de" stroke="${ink}" stroke-opacity="0.25" stroke-width="0.8"/>
      <rect x="24" y="190" width="150" height="9" rx="4.5" fill="#e3e3de"/>
      <rect x="24" y="204" width="96" height="7" rx="3.5" fill="#e9e9e5"/>
      <rect x="188" y="10" width="140" height="214" fill="url(#shimmer)"/>
    </g>
    <rect x="10" y="10" width="460" height="214" rx="5" stroke="${ink}" stroke-width="0.8"/>
    <rect x="22" y="22" width="48" height="18" rx="4" fill="${rec}"/>
    <circle cx="33" cy="31" r="3" fill="#fff"/>
    <text x="41" y="35" ${mono} font-size="10" font-weight="600" fill="#fff">LIVE</text>
    <rect x="76" y="22" width="96" height="18" rx="4" fill="#fff" stroke="${ink}" stroke-opacity="0.3" stroke-width="0.8"/>
    <text x="84" y="34.5" ${mono} font-size="9" fill="${ink}" fill-opacity="0.7">1,284 watching</text>
    ${bars}
    <rect x="16" y="242" width="3" height="12" rx="1" fill="${ink}"/>
    <rect x="22" y="242" width="3" height="12" rx="1" fill="${ink}"/>
    <line x1="40" x2="410" y1="248" y2="248" stroke="#e3e3de" stroke-width="4" stroke-linecap="round"/>
    <line x1="40" x2="386" y1="248" y2="248" stroke="#d2d2cc" stroke-width="4" stroke-linecap="round"/>
    <line x1="40" x2="330" y1="248" y2="248" stroke="#009b44" stroke-width="4" stroke-linecap="round"/>
    <circle cx="330" cy="248" r="5" fill="#fff" stroke="#00792f" stroke-width="1.4"/>
    <circle cx="426" cy="248" r="3" fill="${rec}"/>
    <text x="434" y="251.5" ${mono} font-size="9.5" fill="${ink}" fill-opacity="0.75">LIVE</text>
    <circle cx="12" cy="296" r="11" fill="#e6e6e1"/>
    <rect x="32" y="287" width="210" height="8" rx="4" fill="#e6e6e1"/>
    <rect x="32" y="301" width="130" height="7" rx="3.5" fill="#ececE8"/>
  </svg>`;
}

/** ICO container holding PNG-encoded images. */
function ico(sizes, images) {
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}
