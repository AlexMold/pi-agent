const { chromium } = require('playwright');
const path = require('path');

async function checkResult() {
    const pdfPath = path.resolve('./accounting-automation/Invoice_GC_00004.pdf');
    const outputPath = path.resolve('./accounting-automation/check_v4.png');

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`file://${pdfPath}`);
    await page.setViewportSize({ width: 800, height: 1100 });
    await page.screenshot({ path: outputPath, fullPage: true });
    await browser.close();
    console.log(`Screenshot of current result saved to: ${outputPath}`);
}

checkResult().catch(console.error);
