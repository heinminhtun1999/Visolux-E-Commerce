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

function p(text, { bold } = {}) {
  return new Paragraph({ children: [new TextRun({ text: String(text || ''), bold: Boolean(bold) })] });
}

function cell(children, { widthPct, shading } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    ...(widthPct ? { width: { size: widthPct, type: WidthType.PERCENTAGE } } : {}),
    ...(shading ? { shading: { fill: shading } } : {}),
  });
}

function headerCell(text, widthPct) {
  return cell(p(text, { bold: true }), { widthPct, shading: 'F1F5F9' });
}

function row(cells) {
  return new TableRow({ children: cells });
}

function metricRows() {
  return [
    {
      metric: 'Paid Orders',
      plainFormula: 'Count of orders that are paid (including orders that were later partially or fully refunded).',
      plainMeaning: 'How many customer orders were successfully paid in the selected period.',
    },
    {
      metric: 'Gross Sales',
      plainFormula: 'Add up the order total for all paid orders.',
      plainMeaning: 'Total money collected from customers before subtracting refunds.',
    },
    {
      metric: 'AVG Order Value',
      plainFormula: 'Gross Sales ÷ Paid Orders.',
      plainMeaning: 'Average value per paid order.',
    },
    {
      metric: 'Units Sold',
      plainFormula: 'Add up the quantity of items sold across all paid orders.',
      plainMeaning: 'Total number of product units sold (e.g., 2 pieces counts as 2 units).',
    },
    {
      metric: 'Discounts',
      plainFormula: 'Add up all discount amounts applied to paid orders.',
      plainMeaning: 'Total discounts given to customers (order-level discounts).',
    },
    {
      metric: 'Shipping Collected',
      plainFormula: 'Add up all shipping fees charged on paid orders.',
      plainMeaning: 'Total shipping charges collected from customers.',
    },
    {
      metric: 'Refunds (Confirmed)',
      plainFormula: 'Add up all refunds that have been confirmed/verified as successful.',
      plainMeaning: 'Total money returned to customers (confirmed refunds only).',
    },
    {
      metric: 'Net',
      plainFormula: 'Gross Sales − Refunds (Confirmed).',
      plainMeaning: 'Sales after subtracting confirmed refunds.',
    },
    {
      metric: 'Gross Profit (Estimated)',
      plainFormula: 'For items with a known cost price: (Sales of those items) − (Cost of those items).',
      plainMeaning:
        'Estimated profit based on current inventory cost price. Items without a cost price are excluded from the profit calculation.',
    },
  ];
}

async function main() {
  const generatedAt = new Date().toISOString().replace('T', ' ').replace(/\..+$/, '');

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: 'Sales Report Formulas (Plain English)',
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            children: [new TextRun({ text: `Generated: ${generatedAt}` })],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            text: 'Notes about the report',
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({
                text:
                  'When you select a date range, paid orders are filtered by the order creation date within that range (whole days).',
              }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({
                text:
                  'Refunds are filtered by the date the refund record was created (so a refund can appear on a different day than the original order).',
              }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({
                text:
                  'Gross Profit is an estimate based on the current cost price in inventory; it does not subtract shipping, discounts, or refunds.',
              }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            text: 'Summary metrics',
            heading: HeadingLevel.HEADING_2,
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              row([
                headerCell('Metric', 20),
                headerCell('How it is calculated', 40),
                headerCell('What it tells you', 40),
              ]),
              ...metricRows().map((m) =>
                row([
                  cell(p(m.metric), { widthPct: 20 }),
                  cell(p(m.plainFormula), { widthPct: 40 }),
                  cell(p(m.plainMeaning), { widthPct: 40 }),
                ])
              ),
            ],
          }),
        ],
      },
    ],
  });

  const outPath = path.join(process.cwd(), 'docs', 'generated', 'Sales_Report_Formulas_EN.docx');
  ensureDir(path.dirname(outPath));
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
