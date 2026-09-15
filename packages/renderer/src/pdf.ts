import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

export async function exportPdf(
  html: string,
  outputPath: string,
  assetBaseUrl?: string,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    const documentHtml = assetBaseUrl
      ? html.replace(
          "<head>",
          `<head><base href="${assetBaseUrl.replace(/\/$/, "")}/">`,
        )
      : html;
    await page.setContent(documentHtml, { waitUntil: "networkidle" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", right: "16mm", bottom: "18mm", left: "16mm" },
    });
  } finally {
    await browser.close();
  }
}
