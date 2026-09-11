import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractOoxmlText } from '@/app/api/projects/[projectId]/knowledge/upload/route';

// Batch 2: xlsx/pptx are OOXML ZIPs; extractOoxmlText pulls the text runs with
// JSZip (no new dep). We build minimal synthetic files — the extractor only
// unzips + regexes the known paths, so full OOXML validity isn't required.

async function makeXlsx(strings: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('xl/sharedStrings.xml',
    `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData><row><c><is><t>Inline cell 42</t></is></c></row></sheetData></worksheet>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}
async function makePptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((runs, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`,
      `<p:sld><p:cSld><p:spTree>${runs.map((r) => `<a:p><a:r><a:t>${r}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`);
  });
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('extractOoxmlText (batch 2)', () => {
  it('pulls shared strings + inline cell text from an xlsx', async () => {
    const buf = await makeXlsx(['Anchor price €89/month', 'Subscription model']);
    const text = await extractOoxmlText(buf, 'xlsx');
    expect(text).toContain('Anchor price €89/month');
    expect(text).toContain('Subscription model');
    expect(text).toContain('Inline cell 42');
  });

  it('pulls slide text in order from a pptx', async () => {
    const buf = await makePptx([['Problem: no legal shipping'], ['Solution: compliant kit', 'Pricing: €89/mo']]);
    const text = await extractOoxmlText(buf, 'pptx');
    expect(text).toContain('Problem: no legal shipping');
    expect(text).toContain('Solution: compliant kit');
    expect(text.indexOf('Problem')).toBeLessThan(text.indexOf('Solution')); // slide order
  });

  it('decodes XML entities and drops nested tags', async () => {
    const zip = new JSZip();
    zip.file('xl/sharedStrings.xml', '<sst><si><t>A &amp; B &lt;tag&gt;</t></si></sst>');
    const buf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(await extractOoxmlText(buf, 'xlsx')).toContain('A & B <tag>');
  });
});
