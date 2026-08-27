import path from "path";
import fs from "fs/promises";
import { tmpdir } from "os";
import { Jimp, loadFont } from "jimp";
import { SANS_16_BLACK, SANS_32_WHITE, SANS_64_WHITE } from "jimp/fonts";

/**
 * Thumbnails that show what is actually in the file.
 *
 * PDFs are rasterized by the caller (pdftoimg-js renders the real first page).
 * Everything else used to get a flat colored badge with the file extension
 * printed on it, which told the user nothing. These renderers lay the file's
 * own first page / first slide / first sheet onto a page-shaped canvas, so a
 * DOCX thumbnail shows its opening paragraphs and an XLSX thumbnail shows its
 * actual header row and first records.
 *
 * Deliberately pure Jimp - no LibreOffice, no headless browser, nothing that
 * has to be installed next to the Node process.
 */

// Roughly US Letter, so these sit next to real PDF page renders without the
// card layout jumping.
const PAGE_WIDTH = 620;
const PAGE_HEIGHT = 800;

const PAGE_BG = 0xffffffff;
const RULE = 0xe5e7ebff;

const TYPE_COLORS = {
  docx: 0x2b579aff,
  pptx: 0xd24726ff,
  xlsx: 0x217346ff,
  csv: 0x217346ff,
  pdf: 0xd93025ff,
  generic: 0x475569ff,
};

const HEADER_HEIGHT = 92;
const MARGIN = 44;

let fontCache = new Map();

async function font(definition) {
  if (!fontCache.has(definition)) {
    fontCache.set(definition, await loadFont(definition));
  }
  return fontCache.get(definition);
}

function fillRect(image, x, y, width, height, color) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(image.bitmap.width, Math.round(x + width));
  const y1 = Math.min(image.bitmap.height, Math.round(y + height));

  for (let px = x0; px < x1; px += 1) {
    for (let py = y0; py < y1; py += 1) {
      image.setPixelColor(color, px, py);
    }
  }
}

function outPath(prefix, extension = "png") {
  return path.join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`
  );
}

// Jimp's own wrapping does not let us count or clip lines, and long unbroken
// tokens (URLs, base64 blobs) would otherwise run off the canvas.
function wrapLines(text, charsPerLine, maxLines) {
  const lines = [];

  for (const rawLine of String(text).split(/\r?\n/)) {
    const trimmed = rawLine.replace(/\s+/g, " ").trim();

    if (!trimmed) {
      // Collapse runs of blank lines into a single spacer.
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }

    let current = "";
    for (const word of trimmed.split(" ")) {
      let token = word;

      // Hard-break anything longer than a full line.
      while (token.length > charsPerLine) {
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(token.slice(0, charsPerLine));
        token = token.slice(charsPerLine);
        if (lines.length >= maxLines) return lines.slice(0, maxLines);
      }

      if (!current) {
        current = token;
      } else if (current.length + 1 + token.length <= charsPerLine) {
        current += ` ${token}`;
      } else {
        lines.push(current);
        current = token;
        if (lines.length >= maxLines) return lines.slice(0, maxLines);
      }
    }

    if (current) lines.push(current);
    if (lines.length >= maxLines) return lines.slice(0, maxLines);
  }

  return lines.slice(0, maxLines);
}

async function newPage(label, accent) {
  const image = new Jimp({
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: PAGE_BG,
  });

  fillRect(image, 0, 0, PAGE_WIDTH, HEADER_HEIGHT, accent);

  const headerFont = await font(SANS_32_WHITE);
  image.print({
    font: headerFont,
    x: MARGIN,
    y: 0,
    text: label,
    maxWidth: PAGE_WIDTH - MARGIN * 2,
    maxHeight: HEADER_HEIGHT,
    alignmentY: 16, // middle
  });

  return image;
}

async function writePage(image, prefix) {
  const file = outPath(prefix);
  await image.write(file);
  return file;
}

/** DOCX and anything else that is fundamentally a wall of text. */
async function renderTextPage(label, accent, text, prefix) {
  const image = await newPage(label, accent);
  const bodyFont = await font(SANS_16_BLACK);

  const lineHeight = 26;
  const top = HEADER_HEIGHT + 36;
  const maxLines = Math.floor((PAGE_HEIGHT - top - MARGIN) / lineHeight);
  const charsPerLine = 58;

  const lines = wrapLines(text, charsPerLine, maxLines);

  if (lines.length === 0) {
    return renderBadge(label, accent, prefix);
  }

  lines.forEach((line, index) => {
    if (!line) return;
    image.print({
      font: bodyFont,
      x: MARGIN,
      y: top + index * lineHeight,
      text: line,
      maxWidth: PAGE_WIDTH - MARGIN * 2,
    });
  });

  return writePage(image, prefix);
}

/** PPTX: draw the first slide as a slide, not as a paragraph. */
async function renderSlide(slideTexts, prefix) {
  const accent = TYPE_COLORS.pptx;
  const image = await newPage("PPTX", accent);

  const slide = slideTexts[0] || [];
  const title = slide[0] || "Untitled slide";
  const bullets = slide.slice(1, 7);

  // 16:9 slide canvas centred under the header.
  const slideWidth = PAGE_WIDTH - MARGIN * 2;
  const slideHeight = Math.round((slideWidth * 9) / 16);
  const slideTop = HEADER_HEIGHT + 48;

  fillRect(image, MARGIN, slideTop, slideWidth, slideHeight, 0xf8fafcff);
  fillRect(image, MARGIN, slideTop, slideWidth, 2, RULE);
  fillRect(image, MARGIN, slideTop + slideHeight - 2, slideWidth, 2, RULE);
  fillRect(image, MARGIN, slideTop, 2, slideHeight, RULE);
  fillRect(image, PAGE_WIDTH - MARGIN - 2, slideTop, 2, slideHeight, RULE);

  const bodyFont = await font(SANS_16_BLACK);

  const titleLines = wrapLines(title, 46, 2);
  titleLines.forEach((line, index) => {
    image.print({
      font: bodyFont,
      x: MARGIN + 24,
      y: slideTop + 26 + index * 24,
      text: line,
      maxWidth: slideWidth - 48,
    });
  });

  fillRect(
    image,
    MARGIN + 24,
    slideTop + 26 + titleLines.length * 24 + 10,
    slideWidth - 48,
    2,
    accent
  );

  let cursor = slideTop + 26 + titleLines.length * 24 + 30;
  for (const bullet of bullets) {
    const [line] = wrapLines(bullet, 44, 1);
    if (!line) continue;
    if (cursor > slideTop + slideHeight - 30) break;
    fillRect(image, MARGIN + 26, cursor + 9, 6, 6, accent);
    image.print({
      font: bodyFont,
      x: MARGIN + 42,
      y: cursor,
      text: line,
      maxWidth: slideWidth - 70,
    });
    cursor += 24;
  }

  // Remaining slides as a strip of numbered placeholders.
  const stripTop = slideTop + slideHeight + 34;
  const others = Math.max(0, slideTexts.length - 1);
  if (others > 0) {
    const cardWidth = 84;
    const cardHeight = 56;
    const gap = 14;
    const count = Math.min(others, 5);

    for (let i = 0; i < count; i += 1) {
      const x = MARGIN + i * (cardWidth + gap);
      fillRect(image, x, stripTop, cardWidth, cardHeight, 0xf1f5f9ff);
      const [line] = wrapLines(slideTexts[i + 1]?.[0] || `Slide ${i + 2}`, 11, 1);
      image.print({
        font: bodyFont,
        x: x + 8,
        y: stripTop + 18,
        text: line || `Slide ${i + 2}`,
        maxWidth: cardWidth - 16,
      });
    }
  }

  return writePage(image, prefix);
}

/** XLSX / CSV: render the real header row and first records as a grid. */
async function renderSheet(rows, sheetName, prefix) {
  const accent = TYPE_COLORS.xlsx;
  const image = await newPage("SHEET", accent);
  const bodyFont = await font(SANS_16_BLACK);

  const gridTop = HEADER_HEIGHT + 30;
  const rowHeight = 30;
  const maxRows = Math.floor((PAGE_HEIGHT - gridTop - MARGIN - 24) / rowHeight);
  const visibleRows = rows.slice(0, maxRows);

  if (visibleRows.length === 0) {
    return renderBadge("SHEET", accent, prefix);
  }

  const columnCount = Math.min(
    5,
    Math.max(1, ...visibleRows.map((r) => r.length))
  );
  const gridWidth = PAGE_WIDTH - MARGIN * 2;
  const columnWidth = Math.floor(gridWidth / columnCount);
  const charsPerCell = Math.max(4, Math.floor(columnWidth / 9) - 1);

  if (sheetName) {
    const [name] = wrapLines(sheetName, 40, 1);
    image.print({
      font: bodyFont,
      x: MARGIN,
      y: gridTop - 26,
      text: name,
      maxWidth: gridWidth,
    });
  }

  visibleRows.forEach((row, rowIndex) => {
    const y = gridTop + rowIndex * rowHeight;

    // Header row gets a tint so the grid reads as a spreadsheet.
    if (rowIndex === 0) {
      fillRect(image, MARGIN, y, gridWidth, rowHeight, 0xe8f2ecff);
    } else if (rowIndex % 2 === 0) {
      fillRect(image, MARGIN, y, gridWidth, rowHeight, 0xfafafaff);
    }

    fillRect(image, MARGIN, y + rowHeight - 1, gridWidth, 1, RULE);

    for (let col = 0; col < columnCount; col += 1) {
      const raw = row[col];
      const value = raw === undefined || raw === null ? "" : String(raw);
      const [line] = wrapLines(value, charsPerCell, 1);
      if (line) {
        image.print({
          font: bodyFont,
          x: MARGIN + col * columnWidth + 8,
          y: y + 6,
          text: line,
          maxWidth: columnWidth - 12,
        });
      }
    }
  });

  const gridHeight = visibleRows.length * rowHeight;
  for (let col = 0; col <= columnCount; col += 1) {
    fillRect(image, MARGIN + col * columnWidth, gridTop, 1, gridHeight, RULE);
  }
  fillRect(image, MARGIN, gridTop, gridWidth, 1, RULE);

  if (rows.length > visibleRows.length) {
    image.print({
      font: bodyFont,
      x: MARGIN,
      y: gridTop + gridHeight + 10,
      text: `+${rows.length - visibleRows.length} more rows`,
      maxWidth: gridWidth,
    });
  }

  return writePage(image, prefix);
}

/** Last resort when a file yields nothing renderable. */
async function renderBadge(label, accent, prefix) {
  const image = new Jimp({
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: accent,
  });

  const bigFont = await font(SANS_64_WHITE);
  image.print({
    font: bigFont,
    x: 0,
    y: 0,
    text: label,
    maxWidth: PAGE_WIDTH,
    maxHeight: PAGE_HEIGHT,
    alignmentX: 2, // center
    alignmentY: 16, // middle
  });

  return writePage(image, prefix || "thumb-badge");
}

/** PPTX slide text, straight out of the OOXML package. */
export async function readPptxSlides(filePath, maxSlides = 6) {
  const AdmZip = (await import("adm-zip")).default;
  const { XMLParser } = await import("fast-xml-parser");

  const zip = new AdmZip(filePath);

  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const num = (n) => parseInt(n.entryName.match(/slide(\d+)\.xml$/)[1], 10);
      return num(a) - num(b);
    })
    .slice(0, maxSlides);

  const parser = new XMLParser({
    ignoreAttributes: true,
    // Keep every <a:t> even when a shape has exactly one, so the shape below
    // does not change based on slide contents.
    isArray: (name) => name === "a:t",
  });

  const slides = [];

  for (const entry of slideEntries) {
    const xml = entry.getData().toString("utf8");
    const parsed = parser.parse(xml);

    const texts = [];
    const walk = (node) => {
      if (node === null || node === undefined) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== "object") return;

      for (const [key, value] of Object.entries(node)) {
        if (key === "a:t") {
          for (const t of [].concat(value)) {
            const text = String(t).trim();
            if (text) texts.push(text);
          }
        } else {
          walk(value);
        }
      }
    };

    walk(parsed);
    slides.push(texts);
  }

  return slides;
}

/**
 * Builds a thumbnail for a non-PDF file. `content` is the already-extracted
 * text, passed in so this never re-parses a file the processor just read.
 */
export async function generateContentThumbnail(filePath, fileType, content) {
  switch (fileType) {
    case "docx":
      return renderTextPage(
        "DOCX",
        TYPE_COLORS.docx,
        content || "",
        "thumb-docx"
      );

    case "pptx": {
      const slides = await readPptxSlides(filePath);
      if (slides.length === 0 || slides.every((s) => s.length === 0)) {
        return renderTextPage(
          "PPTX",
          TYPE_COLORS.pptx,
          content || "",
          "thumb-pptx"
        );
      }
      return renderSlide(slides, "thumb-pptx");
    }

    case "xlsx": {
      const { readSheetRows } = await import("./spreadsheet.js");
      const [first] = await readSheetRows(filePath, {
        maxRows: 40,
        maxSheets: 1,
      });
      return renderSheet(first?.rows ?? [], first?.name, "thumb-xlsx");
    }

    case "csv": {
      const raw = content ?? (await fs.readFile(filePath, "utf8"));
      const rows = parseCsvRows(raw, 40);
      return renderSheet(rows, null, "thumb-csv");
    }

    default:
      return renderBadge(
        (fileType || "FILE").toUpperCase(),
        TYPE_COLORS.generic,
        "thumb-generic"
      );
  }
}

export async function generateFallbackThumbnail(fileType) {
  return renderBadge(
    (fileType || "FILE").toUpperCase(),
    TYPE_COLORS[fileType] || TYPE_COLORS.generic,
    "thumb-fallback"
  );
}

/**
 * Minimal RFC 4180 reader - enough to keep quoted commas and embedded newlines
 * from shredding the preview grid the way a naive split(",") does.
 */
export function parseCsvRows(text, maxRows = 40) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);

  return rows.slice(0, maxRows);
}

/**
 * Derives the thumbnail's S3 key from the document's key.
 *
 * The old version did s3Key.replace("/uploads/", "/thumbnails/"), but keys are
 * generated as "uploads/<userId>/..." with no leading slash, so the replace
 * never matched and every thumbnail was written back into uploads/.
 */
export function thumbnailKeyFor(s3Key, thumbnailPath) {
  const extension = path.extname(thumbnailPath) || ".png";
  const base = s3Key.startsWith("uploads/")
    ? `thumbnails/${s3Key.slice("uploads/".length)}`
    : `thumbnails/${s3Key}`;

  return `${base}${extension}`;
}

export function thumbnailContentType(thumbnailPath) {
  // Badges and rendered pages are PNG; PDF page renders are JPEG. Uploading a
  // PNG as image/jpeg made some CDNs and browsers refuse to render it.
  return path.extname(thumbnailPath).toLowerCase() === ".jpg" ||
    path.extname(thumbnailPath).toLowerCase() === ".jpeg"
    ? "image/jpeg"
    : "image/png";
}
