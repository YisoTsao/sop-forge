import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportPdf } from '../packages/renderer/src/pdf.js';

describe('PDF exporter', () => {
  it('prints the supplied HTML into a readable PDF', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sop-forge-pdf-'));
    const outputPath = path.join(dataDir, 'sop.pdf');

    try {
      await exportPdf('<html><body><h1>Recorded SOP</h1><p>Step one</p></body></html>', outputPath);
      const pdf = await readFile(outputPath);
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(500);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
