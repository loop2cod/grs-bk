const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const W = 216;
const H = 288;
const M = 8;
const PAD = 6;

const generateLabel = async (shipment) => {
  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    info: { Title: `Shipment Label - ${shipment.trackingNumber}` },
  });

  const bufs = [];
  doc.on('data', (c) => bufs.push(c));

  const boxW = W - 2 * M;

  // ─── palette ───
  const ink = '#111827';      // near-black text
  const sub = '#4b5563';      // secondary text
  const navy = '#0f2a4a';     // brand band
  const line = '#d5dbe3';     // hairline borders
  const panel = '#f7f9fc';    // subtle panel fill
  const accent = '#c8102e';   // COD / alert red

  const pm = shipment.paymentMethod || 'cod';
  const isCOD = pm === 'cod';
  const isPartial = pm === 'partial';
  const badgeLabel = isCOD ? 'COD' : isPartial ? 'PARTIAL' : 'PREPAID';
  const pendingAmount = isPartial
    ? Math.max(0, (shipment.totalCollectible || 0) - (shipment.paidAmount || 0))
    : isCOD ? (shipment.totalCollectible || 0) : 0;

  // ─── outer frame ───
  doc.rect(1.5, 1.5, W - 3, H - 3).lineWidth(1).stroke(line);

  // ─── brand header ───
  const headerH = 22;
  doc.rect(M, M, boxW, headerH).fill(navy);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
  doc.text('GRS DELIVERY', M + PAD, M + 5, { width: boxW * 0.6 });

  // payment-mode badge, top-right of header
  const badgeText = badgeLabel;
  doc.font('Helvetica-Bold').fontSize(7.5);
  const badgeW = doc.widthOfString(badgeText) + 12;
  const badgeH = 12;
  const badgeX = M + boxW - badgeW - 6;
  const badgeY = M + (headerH - badgeH) / 2;
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2).fill(isCOD ? accent : '#1f8a4c');
  doc.fillColor('#ffffff').text(badgeText, badgeX, badgeY + 2.5, { width: badgeW, align: 'center' });

  let y = M + headerH + 5;

  // ─── QR (left) + tracking number (right) ───
  const qrSize = 56;
  const codeRowH = qrSize;
  const trackX = M + qrSize + 12;
  const trackW = boxW - qrSize - 12;

  try {
    const qr = await bwipjs.toBuffer({
      bcid: 'qrcode',
      text: shipment.trackingNumber,
      scale: 1,
      width: qrSize,
      height: qrSize,
      includetext: false,
      backgroundcolor: 'FFFFFF',
    });
    doc.image(qr, M, y, { width: qrSize, height: qrSize });
  } catch {
    doc.rect(M, y, qrSize, qrSize).strokeColor(line).stroke();
  }

  doc.fillColor(sub).font('Helvetica-Bold').fontSize(7);
  doc.text('TRACKING NO.', trackX, y + codeRowH / 2 - 12, { width: trackW, align: 'right' });
  doc.fillColor(ink).font('Courier-Bold').fontSize(12);
  doc.text(shipment.trackingNumber, trackX, y + codeRowH / 2 - 1, { width: trackW, align: 'right' });

  y += codeRowH + 5;

  // ─── FROM / TO panels ───
  const paneGap = 8;
  const paneW = (boxW - paneGap) / 2;
  const panePad = PAD + 3;
  const textW = paneW - 2 * panePad;
  const bodyLineGap = 3;

  const deliveryExtra = [
    shipment.deliveryContactName ? `Attn: ${shipment.deliveryContactName}` : null,
    shipment.deliveryContactPhone ? `Tel: ${shipment.deliveryContactPhone}` : null,
  ].filter(Boolean);

  const pickupLines = [shipment.pickupAddress || 'N/A'];
  const deliveryLines = [shipment.deliveryAddress || 'N/A', ...deliveryExtra];

  doc.font('Helvetica').fontSize(7);
  const measure = (bodyLines) =>
    bodyLines.reduce((h, t) => h + doc.heightOfString(t, { width: textW, lineGap: 1.5 }) + bodyLineGap, 0);

  // both panels share one height, driven by whichever needs more vertical space
  const topPad = 14;
  const bottomPad = 4;
  const paneH = topPad + Math.max(measure(pickupLines), measure(deliveryLines)) + bottomPad;

  const drawPane = (label, x, bodyLines) => {
    doc.rect(x, y, paneW, paneH).fillColor(panel).fill();
    doc.rect(x, y, paneW, paneH).lineWidth(0.75).strokeColor(line).stroke();

    doc.fillColor(navy).font('Helvetica-Bold').fontSize(6);
    doc.text(label, x + panePad, y + 6, { characterSpacing: 0.6 });

    doc.fillColor(ink).font('Helvetica').fontSize(7);
    let ly = y + topPad;
    bodyLines.forEach((t) => {
      doc.text(t, x + panePad, ly, { width: textW, lineGap: 1.5 });
      ly += doc.heightOfString(t, { width: textW, lineGap: 1.5 }) + bodyLineGap;
    });
  };

  drawPane('FROM  ·  PICKUP', M, pickupLines);
  drawPane('TO  ·  DELIVERY', M + paneW + paneGap, deliveryLines);

  y += paneH + 5;

  // ─── details table ───
  const cName = shipment.customer?.name || '—';
  const cbName = shipment.createdBy?.name || '—';
  const cbRole = shipment.createdBy?.role || '';
  const cbLabel = cbRole ? `${cbName} (${cbRole})` : cbName;
  const dt = new Date(shipment.createdAt || Date.now());
  const dStr = dt.toLocaleDateString('en-GB');
  const tStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const weightStr = `${(shipment.totalWeight || 0).toFixed(2)} kg`;

  const cells = [
    ['CUSTOMER', cName],
    ['BOOKED BY', cbLabel],
    ['DATE / TIME', `${dStr} ${tStr}`],
    ['WEIGHT', weightStr],
    ['PAYMENT', isCOD ? `COD${shipment.codType === 'pay_first' ? ' (Pay First)' : ''}` : isPartial ? 'Partial' : 'Prepaid'],
  ];
  if (isCOD || isPartial) {
    cells.push(['ITEM VALUE', `AED ${Number(shipment.itemValue || 0).toFixed(2)}`]);
    cells.push(['DELIVERY FEE', `AED ${Number(shipment.deliveryCharge || shipment.finalAmount || 0).toFixed(2)}`]);
  }
  if (isPartial) {
    cells.push(['AMOUNT PAID', `AED ${Number(shipment.paidAmount || 0).toFixed(2)}`]);
  }

  const cols = 2;
  const cellW = boxW / cols;
  const cellH = 13;
  const tableH = Math.ceil(cells.length / cols) * cellH;

  doc.rect(M, y, boxW, tableH).lineWidth(0.75).strokeColor(line).stroke();
  cells.forEach(([k, v], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = M + col * cellW;
    const cy = y + row * cellH;

    if (col > 0) doc.moveTo(cx, cy).lineTo(cx, cy + cellH).lineWidth(0.5).strokeColor(line).stroke();
    if (row > 0) doc.moveTo(cx, cy).lineTo(cx + cellW, cy).lineWidth(0.5).strokeColor(line).stroke();

    doc.fillColor(sub).font('Helvetica-Bold').fontSize(5).text(k, cx + PAD, cy + 1.5, { characterSpacing: 0.4 });
    doc.fillColor(ink).font('Helvetica').fontSize(6).text(v, cx + PAD, cy + 6.5, { width: cellW - 2 * PAD });
  });

  y += tableH + 5;

  // ─── COD / Pending amount banner (only if applicable) ───
  if (pendingAmount > 0) {
    const codH = 22;
    const label = isPartial ? 'PENDING TO COLLECT' : 'COD TO COLLECT';
    doc.rect(M, y, boxW, codH).fillColor('#fdecee').fill();
    doc.rect(M, y, boxW, codH).lineWidth(0.75).strokeColor(accent).stroke();
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(7.5);
    doc.text(`${label}: AED ${Number(pendingAmount).toFixed(2)}`, M, y + 3, { width: boxW, align: 'center' });
    const breakdown = isPartial
      ? `Total AED ${Number(shipment.totalCollectible || 0).toFixed(2)} — Paid AED ${Number(shipment.paidAmount || 0).toFixed(2)}`
      : `Item AED ${Number(shipment.itemValue || 0).toFixed(2)} + Delivery AED ${Number(shipment.deliveryCharge || shipment.finalAmount || 0).toFixed(2)}`;
    doc.fillColor(accent).font('Helvetica').fontSize(5.5);
    doc.text(breakdown, M, y + 12, { width: boxW, align: 'center' });
    y += codH + 5;
  }

  // ─── footer ───
  const footerH = 30;
  doc.rect(M, y, boxW, footerH).fill(navy);
  doc.fillColor('#ffffff');

  doc.font('Helvetica-Bold').fontSize(6);
  doc.text('+971 54 582 1123   ·   support@grsdeliver.com', M + PAD, y + 5, { width: boxW - 2 * PAD, align: 'center' });
  doc.font('Helvetica').fontSize(4.75);
  doc.text('Sharjah Publishing City Free Zone, Sharjah, UAE', M + PAD, y + 14, { width: boxW - 2 * PAD, align: 'center' });
  doc.font('Helvetica').fontSize(4.5).fillColor('#c6d3e3');
  // ─── corner brackets ───
  const cd = 5;
  doc.lineWidth(1.25).strokeColor(navy);
  [[M - 2, M - 2], [W - M + 2, M - 2], [M - 2, H - M + 2], [W - M + 2, H - M + 2]]
    .forEach(([cx, cy]) => doc.moveTo(cx - cd, cy).lineTo(cx, cy).lineTo(cx, cy - cd).stroke());

  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(bufs))));
};

module.exports = { generateLabel };
