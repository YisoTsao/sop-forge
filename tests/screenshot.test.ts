import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { annotateScreenshot } from '../packages/screenshot/src/index.js';

describe('screenshot annotation', () => {
  it('generates a derived image with a marker without changing dimensions', async () => {
    const original = await sharp({ create: { width: 120, height: 80, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const result = await annotateScreenshot(original, {
      coordinates: { x: 40, y: 30 },
      boundingBox: { x: 20, y: 15, width: 40, height: 30 },
    });

    expect(result.annotated).toBe(true);
    expect(result.buffer.equals(original)).toBe(false);
    await expect(sharp(result.buffer).metadata()).resolves.toMatchObject({ width: 120, height: 80, format: 'png' });

    const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    const cornerOffset = (15 * 120 + 20) * 4;
    expect([...data.subarray(cornerOffset, cornerOffset + 3)]).toEqual([255, 255, 255]);
  });

  it('returns the original image when target geometry is unavailable', async () => {
    const original = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const result = await annotateScreenshot(original, {});

    expect(result.annotated).toBe(false);
    expect(result.buffer.equals(original)).toBe(true);
  });
});
