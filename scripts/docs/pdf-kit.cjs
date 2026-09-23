/**
 * The page furniture both documents in this folder are drawn with — the
 * palette, the headings, the step boxes, the tables, the footers.
 *
 * It sits in its own module because there are two documents now
 * (flow-pdf.cjs, the whole story, and flow-pdf-short.cjs, the two-page
 * version) and a heading that drifts between them is a document that looks
 * like it came from somewhere else.
 *
 * Laid out by hand rather than flowed: PDFKit adds a page of its own whenever
 * text lands at or past the bottom margin, even at an explicit position, so
 * the bottom margin is zeroed and `need()` is the only thing that paginates.
 * The base-14 fonts are WinAnsi — arrows and other glyphs outside it render as
 * noise, which is why the diagrams use ASCII.
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");

// ---------------------------------------------------------------- palette
const INK = "#1b1b1f";
const MUTED = "#5f6570";
const FAINT = "#9aa0aa";
const GOLD = "#a8751d";
const LINE = "#d8dbe0";
const BOX = "#f6f7f9";
const OK = "#2f7d4f";
const BAD = "#b5322e";
const WARN = "#a8651d";

const PAGE = { size: "A4", margins: { top: 54, bottom: 54, left: 54, right: 54 } };

/** Opens a document at `out` and hands back the drawing kit for it. */
function createDoc(out, info) {
  const doc = new PDFDocument({ ...PAGE, bufferPages: true, info });
  doc.pipe(fs.createWriteStream(out));

  const W = doc.page.width - PAGE.margins.left - PAGE.margins.right;
  const L = PAGE.margins.left;
  const BOTTOM = doc.page.height - PAGE.margins.bottom;

  /**
   * Every box, row and code block here is drawn at an absolute y that `need()`
   * has already checked. PDFKit does not know that: it adds a page of its own
   * whenever text lands at or past the bottom margin — even with an explicit
   * position and lineBreak:false — so a block near the foot of a page got two
   * page breaks, mine and its, and the blank page in between.
   *
   * Zeroing the bottom margin turns that automatic break off. `need()` is then
   * the only thing that paginates, which is what the layout already assumed.
   */
  function suppressAutoBreak() {
    doc.page.margins.bottom = 0;
  }
  doc.on("pageAdded", suppressAutoBreak);
  suppressAutoBreak();

  // ----------------------------------------------------------- primitives
  function need(h) {
    if (doc.y + h > BOTTOM) doc.addPage();
  }

  function h1(t) {
    need(120);
    doc.font("Helvetica-Bold").fontSize(17).fillColor(INK).text(t, L, doc.y);
    doc.moveDown(0.15);
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1.4).strokeColor(GOLD).stroke();
    doc.moveDown(0.7);
  }

  function h2(t) {
    need(78);
    doc.moveDown(0.35);
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(INK).text(t, L, doc.y);
    doc.moveDown(0.35);
  }

  function p(t, opts = {}) {
    need(28);
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(opts.size || 9.5)
      .fillColor(opts.color || MUTED)
      .text(t, L + (opts.indent || 0), doc.y, { width: W - (opts.indent || 0), lineGap: 2.2 });
    doc.moveDown(opts.gap ?? 0.45);
  }

  function bullets(items, opts = {}) {
    for (const it of items) {
      need(20);
      const y = doc.y;
      doc.font("Helvetica").fontSize(9.5).fillColor(GOLD).text("•", L + 4 + (opts.indent || 0), y, { width: 10 });
      doc.font("Helvetica").fontSize(9.5).fillColor(MUTED)
        .text(it, L + 18 + (opts.indent || 0), y, { width: W - 18 - (opts.indent || 0), lineGap: 2 });
      doc.moveDown(0.28);
    }
    doc.moveDown(0.25);
  }

  function mono(lines, opts = {}) {
    const pad = 9;
    const lh = 11.2;
    const h = lines.length * lh + pad * 2;
    need(h + 8);
    const y = doc.y;
    doc.roundedRect(L, y, W, h, 4).fillColor(opts.bg || "#f3f4f6").fill();
    if (opts.accent) {
      doc.rect(L, y, 3, h).fillColor(opts.accent).fill();
    }
    doc.font("Courier").fontSize(8.2).fillColor(opts.color || "#2c3038");
    lines.forEach((ln, i) => {
      doc.text(ln, L + pad + (opts.accent ? 4 : 0), y + pad + i * lh, { width: W - pad * 2, lineBreak: false });
    });
    doc.y = y + h + 10;
  }

  /** A labelled step box in the vertical flow spine. */
  function stepBox(n, title, lines, opts = {}) {
    const pad = 10;
    const titleH = 15;
    const lh = 11.5;
    const h = pad * 2 + titleH + lines.length * lh;
    need(h + 26);
    const y = doc.y;

    doc.roundedRect(L, y, W, h, 5).fillColor(BOX).fill();
    doc.roundedRect(L, y, W, h, 5).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.rect(L, y, 3.5, h).fillColor(opts.accent || GOLD).fill();

    // number chip
    doc.circle(L + 20, y + pad + 5, 8.5).fillColor(opts.accent || GOLD).fill();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
      .text(String(n), L + 20 - 8.5, y + pad + 1.6, { width: 17, align: "center" });

    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK)
      .text(title, L + 36, y + pad + 0.5, { width: W - 46 });

    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    lines.forEach((ln, i) => {
      const isNote = ln.startsWith("!");
      doc.fillColor(isNote ? WARN : MUTED)
        .text(isNote ? ln.slice(1) : ln, L + 36, y + pad + titleH + i * lh, { width: W - 46, lineBreak: false });
    });

    doc.y = y + h;
    if (!opts.last) arrow();
  }

  function arrow() {
    const h = 16;
    need(h);
    const x = L + 20;
    const y = doc.y;
    doc.moveTo(x, y + 2).lineTo(x, y + h - 5).lineWidth(1.1).strokeColor(FAINT).stroke();
    doc.moveTo(x - 3.2, y + h - 7).lineTo(x, y + h - 2.5).lineTo(x + 3.2, y + h - 7)
      .lineWidth(1.1).strokeColor(FAINT).stroke();
    doc.y = y + h;
  }

  /** Simple 2-3 column table. `widths` are fractions of W. */
  function table(headers, rows, widths, opts = {}) {
    const cw = widths.map((f) => f * W);
    const pad = 6;
    const fs_ = opts.size || 8.6;

    function rowHeight(cells, bold) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fs_);
      return Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: cw[i] - pad * 2, lineGap: 1.5 }))) + pad * 1.7;
    }

    function drawRow(cells, { bold = false, bg = null, colors = [] } = {}) {
      const h = rowHeight(cells, bold);
      need(h + 4);
      const y = doc.y;
      if (bg) doc.rect(L, y, W, h).fillColor(bg).fill();
      let x = L;
      cells.forEach((c, i) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fs_)
          .fillColor(colors[i] || (bold ? INK : MUTED))
          .text(String(c), x + pad, y + pad * 0.85, { width: cw[i] - pad * 2, lineGap: 1.5 });
        x += cw[i];
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    }

    // Keep the whole table on one page when it can be. Splitting it left a
    // header on one page and two orphaned rows on the next, which reads as a
    // different table rather than the end of this one. A table too tall for any
    // page still flows, because forcing a break would not help it.
    const usable = BOTTOM - PAGE.margins.top;
    const total =
      rowHeight(headers, true) + rows.reduce((sum, r) => sum + rowHeight(r.cells ?? r, false), 0);
    if (total <= usable) need(total);

    drawRow(headers, { bold: true, bg: "#eceef1" });
    rows.forEach((r) => drawRow(r.cells ?? r, { colors: r.colors || [] }));
    doc.moveDown(0.6);
  }

  function statusLine(label, value, color) {
    need(16);
    const y = doc.y;
    doc.circle(L + 4, y + 5, 3).fillColor(color).fill();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(label, L + 14, y, { width: 190, lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(value, L + 210, y, { width: W - 210, lineBreak: false });
    doc.y = y + 14;
  }

  /** The dark band at the top of page one. */
  function cover({ title, subtitle, meta, height = 150, startY = 178 }) {
    doc.rect(0, 0, doc.page.width, height).fillColor("#16181b").fill();
    doc.font("Helvetica-Bold").fontSize(23).fillColor("#f2efe8").text(title, L, 46, { width: W });
    doc.font("Helvetica").fontSize(12.5).fillColor("#c7a15a").text(subtitle, L, 78, { width: W });
    doc.font("Helvetica").fontSize(8.8).fillColor("#8b9099").text(meta, L, 106, { width: W });
    doc.y = startY;
  }

  /** Rule, running title and page numbers on every page, then close. */
  function finish(runningTitle) {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const y = doc.page.height - 34;
      doc.moveTo(L, y - 8).lineTo(L + W, y - 8).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font("Helvetica").fontSize(7.6).fillColor(FAINT)
        .text(runningTitle, L, y, { width: W / 2, lineBreak: false });
      doc.font("Helvetica").fontSize(7.6).fillColor(FAINT)
        .text(`${i + 1} / ${range.count}`, L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
    }
    doc.end();
    console.log("written:", out);
  }

  return { doc, L, W, BOTTOM, need, h1, h2, p, bullets, mono, stepBox, table, statusLine, cover, finish };
}

module.exports = { createDoc, INK, MUTED, FAINT, GOLD, LINE, BOX, OK, BAD, WARN };
