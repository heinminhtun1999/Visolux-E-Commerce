/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} = require('docx');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function headingLevelFromDepth(depth) {
  if (depth === 1) return HeadingLevel.HEADING_1;
  if (depth === 2) return HeadingLevel.HEADING_2;
  if (depth === 3) return HeadingLevel.HEADING_3;
  if (depth === 4) return HeadingLevel.HEADING_4;
  if (depth === 5) return HeadingLevel.HEADING_5;
  return HeadingLevel.HEADING_6;
}

function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');

  const blocks = [];
  let inCode = false;
  let codeLines = [];

  for (const rawLine of lines) {
    const line = String(rawLine);

    const fence = line.trim().startsWith('```');
    if (fence) {
      if (inCode) {
        blocks.push({ type: 'code', text: codeLines.join('\n') });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', depth: h[1].length, text: h[2] });
      continue;
    }

    const bullet = /^-\s+(.+?)\s*$/.exec(line);
    if (bullet) {
      blocks.push({ type: 'bullet', text: bullet[1] });
      continue;
    }

    if (!line.trim()) {
      blocks.push({ type: 'blank' });
      continue;
    }

    blocks.push({ type: 'para', text: line });
  }

  if (inCode && codeLines.length) {
    blocks.push({ type: 'code', text: codeLines.join('\n') });
  }

  return blocks;
}

function codeParagraph(text) {
  const lines = String(text || '').split('\n');
  const runs = [];
  for (let i = 0; i < lines.length; i += 1) {
    runs.push(
      new TextRun({
        text: lines[i],
        font: 'Consolas',
        size: 20,
        ...(i === 0 ? {} : { break: 1 }),
      })
    );
  }

  return new Paragraph({
    children: runs,
    spacing: { before: 120, after: 120 },
  });
}

function blocksToDocChildren(blocks) {
  const children = [];

  for (const b of blocks) {
    if (b.type === 'blank') {
      children.push(new Paragraph({ text: '' }));
      continue;
    }

    if (b.type === 'heading') {
      children.push(
        new Paragraph({
          text: b.text,
          heading: headingLevelFromDepth(b.depth),
        })
      );
      continue;
    }

    if (b.type === 'bullet') {
      children.push(
        new Paragraph({
          text: b.text,
          bullet: { level: 0 },
        })
      );
      continue;
    }

    if (b.type === 'code') {
      children.push(codeParagraph(b.text));
      continue;
    }

    // Regular paragraph
    children.push(
      new Paragraph({
        children: [new TextRun({ text: b.text })],
      })
    );
  }

  return children;
}

async function writeDocx({ title, subtitle, markdownPath, outPath }) {
  const md = readText(markdownPath);
  const blocks = parseMarkdown(md);

  const generatedAt = new Date().toISOString().replace('T', ' ').replace(/\..+$/, ' UTC');

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: subtitle,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: `Generated: ${generatedAt}`,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: '' }),
          ...blocksToDocChildren(blocks),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath}`);
}

async function main() {
  const root = process.cwd();

  await writeDocx({
    title: 'Visolux E-Commerce',
    subtitle: 'Admin Manual',
    markdownPath: path.join(root, 'docs', 'manuals', 'ADMIN_MANUAL.md'),
    outPath: path.join(root, 'docs', 'generated', 'Visolux_Admin_Manual.docx'),
  });

  await writeDocx({
    title: 'Visolux E-Commerce',
    subtitle: 'Developer Guide',
    markdownPath: path.join(root, 'docs', 'manuals', 'DEVELOPER_GUIDE.md'),
    outPath: path.join(root, 'docs', 'generated', 'Visolux_Developer_Guide.docx'),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
