/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require('docx');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function monospace(text) {
  return new TextRun({ text: String(text || ''), font: 'Consolas' });
}

function para(text, { bold } = {}) {
  return new Paragraph({ children: [new TextRun({ text: String(text || ''), bold: Boolean(bold) })] });
}

function cell(children, { widthPct, shading } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    ...(widthPct
      ? { width: { size: widthPct, type: WidthType.PERCENTAGE } }
      : {}),
    ...(shading
      ? {
          shading: {
            fill: shading,
          },
        }
      : {}),
  });
}

function headerCell(text, widthPct) {
  return cell(para(text, { bold: true }), { widthPct, shading: 'F1F5F9' });
}

function row(cells) {
  return new TableRow({ children: cells });
}

function metricRows() {
  return [
    {
      metric: 'Paid Orders',
      formula: "COUNT(*) over orders where payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')",
      sources: 'orders.payment_status, orders.created_at',
      notes: "Includes refunded orders (status 'REFUNDED') and partially refunded orders.",
    },
    {
      metric: 'Gross Sales',
      formula: 'SUM(orders.total_amount) over the paid orders set',
      sources: 'orders.total_amount',
      notes: 'Stored in cents; displayed as RM.',
    },
    {
      metric: 'AVG Order Value',
      formula: 'ROUND(GrossSales / PaidOrders) (0 if PaidOrders = 0)',
      sources: 'derived from Gross Sales and Paid Orders',
      notes: 'Rounded to the nearest cent.',
    },
    {
      metric: 'Units Sold',
      formula: 'SUM(order_items.quantity) joined to paid orders',
      sources: 'order_items.quantity, orders.order_id',
      notes: 'Counts units sold across paid orders.',
    },
    {
      metric: 'Discounts',
      formula: 'SUM(orders.discount_amount) over the paid orders set',
      sources: 'orders.discount_amount',
      notes: 'Order-level discount total in cents.',
    },
    {
      metric: 'Shipping Collected',
      formula: 'SUM(orders.shipping_fee) over the paid orders set',
      sources: 'orders.shipping_fee',
      notes: 'Shipping charged/collected on orders in cents.',
    },
    {
      metric: 'Refunds (Confirmed)',
      formula:
        'SUM(order_item_refunds.amount_refunded) + SUM(order_refunds.amount_refunded) over confirmed refunds',
      sources: 'order_item_refunds, order_refunds',
      notes:
        "Confirmed when provider <> 'FIUU' OR (provider_status = '00' AND provider_signature_ok = 1). Filtered/grouped by refund created_at.",
    },
    {
      metric: 'Net',
      formula: 'GrossSales - RefundsConfirmed',
      sources: 'derived',
      notes: 'Gross order totals minus confirmed refunds.',
    },
    {
      metric: 'Gross Profit (est.)',
      formula: 'KnownSales - KnownCOGS (only where inventory.cost_price IS NOT NULL)',
      sources: 'order_items.subtotal, order_items.quantity, inventory.cost_price',
      notes:
        'Estimated using current inventory cost price; excludes items with unknown cost from profit calculation.',
    },
  ];
}

async function main() {
  const generatedAt = new Date().toISOString().replace('T', ' ').replace(/\..+$/, '');

  const title = new Paragraph({
    text: 'Sales Report – Metric Formulas',
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
  });

  const subtitle = new Paragraph({
    children: [new TextRun({ text: `Generated: ${generatedAt}` })],
    alignment: AlignmentType.CENTER,
  });

  const scopeHeading = new Paragraph({ text: 'Scope & Filters', heading: HeadingLevel.HEADING_2 });

  const scopeBullets = [
    new Paragraph({
      bullet: { level: 0 },
      children: [
        new TextRun({ text: 'Orders are filtered by ' }),
        monospace('orders.created_at'),
        new TextRun({ text: ' (whole-day range when date_from/date_to are provided).' }),
      ],
    }),
    new Paragraph({
      bullet: { level: 0 },
      children: [
        new TextRun({ text: 'Paid orders set: ' }),
        monospace("payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')"),
      ],
    }),
    new Paragraph({
      bullet: { level: 0 },
      children: [
        new TextRun({ text: 'Refunds are filtered by refund record timestamps (' }),
        monospace('order_item_refunds.created_at'),
        new TextRun({ text: ' / ' }),
        monospace('order_refunds.created_at'),
        new TextRun({ text: ').' }),
      ],
    }),
    new Paragraph({
      bullet: { level: 0 },
      children: [
        new TextRun({ text: 'Confirmed refund rule: ' }),
        monospace("provider <> 'FIUU'"),
        new TextRun({ text: ' OR ' }),
        monospace("(provider_status = '00' AND provider_signature_ok = 1)"),
        new TextRun({ text: '.' }),
      ],
    }),
  ];

  const tableHeading = new Paragraph({ text: 'Summary Metrics', heading: HeadingLevel.HEADING_2 });

  const header = row([
    headerCell('Metric', 18),
    headerCell('Formula (as implemented)', 38),
    headerCell('Source tables/fields', 22),
    headerCell('Notes / nuance', 22),
  ]);

  const rows = metricRows().map((m) =>
    row([
      cell(para(m.metric), { widthPct: 18 }),
      cell(new Paragraph({ children: [monospace(m.formula)] }), { widthPct: 38 }),
      cell(new Paragraph({ children: [monospace(m.sources)] }), { widthPct: 22 }),
      cell(para(m.notes), { widthPct: 22 }),
    ])
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows],
  });

  const profitHeading = new Paragraph({ text: 'Gross Profit (est.) details', heading: HeadingLevel.HEADING_2 });

  const profitParas = [
    new Paragraph({
      children: [
        new TextRun({ text: 'KnownSales = SUM(' }),
        monospace('order_items.subtotal'),
        new TextRun({ text: ') only where ' }),
        monospace('inventory.cost_price IS NOT NULL'),
        new TextRun({ text: '.' }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'KnownCOGS = SUM(' }),
        monospace('order_items.quantity * inventory.cost_price'),
        new TextRun({ text: ') only where ' }),
        monospace('inventory.cost_price IS NOT NULL'),
        new TextRun({ text: '.' }),
      ],
    }),
    new Paragraph({
      children: [new TextRun({ text: 'GrossProfitEst = KnownSales - KnownCOGS.' })],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'UnknownCostUnits = SUM(order_items.quantity) where ' }),
        monospace('inventory.cost_price IS NULL'),
        new TextRun({ text: ' (tracked separately).' }),
      ],
    }),
    new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text: 'Uses current inventory cost price at report time (not a historical snapshot).' })],
    }),
    new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text: 'Does not subtract discounts, shipping, or refunds (item-subtotal margin estimate).' })],
    }),
  ];

  const codeRefHeading = new Paragraph({ text: 'Code reference', heading: HeadingLevel.HEADING_2 });
  const codeRefs = [
    new Paragraph({ children: [new TextRun({ text: 'Implemented in: ' }), monospace('src/repositories/reportRepo.js (getSalesReport)')] }),
    new Paragraph({ children: [new TextRun({ text: 'Rendered by: ' }), monospace('views/admin/sales_report.ejs')] }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          title,
          subtitle,
          new Paragraph({ text: '' }),
          scopeHeading,
          ...scopeBullets,
          new Paragraph({ text: '' }),
          tableHeading,
          table,
          new Paragraph({ text: '' }),
          profitHeading,
          ...profitParas,
          new Paragraph({ text: '' }),
          codeRefHeading,
          ...codeRefs,
        ],
      },
    ],
  });

  const outPath = path.join(process.cwd(), 'docs', 'generated', 'Sales_Report_Formulas.docx');
  ensureDir(path.dirname(outPath));
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
