const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function snapshotTemplate() {
    const templatePath = path.resolve('./accounting-automation/invoice-template.html');
    const outputPath = path.resolve('./accounting-automation/template_snapshot.png');

    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    let html = fs.readFileSync(templatePath, 'utf8');
    // Fill with sample data for the snapshot
    html = html
        .replace('{{INVOICE_ID}}', '00051')
        .replace('{{PO_NUMBER}}', 'VAUB8091')
        .replace('{{DATE}}', '01.04.2026')
        .replace('{{CLIENT_NAME}}', 'Vauban Technologies LTD')
        .replace('{{CLIENT_ADDRESS}}', '186 Shoreditch High Street\nLondon, GB-LND E1 6HU\nUnited Kingdom')
        .replace('{{TABLE_ROWS}}', '<tr><td style="text-align:center">1</td><td>Software services</td><td style="text-align:right">7840</td><td style="text-align:right">7840</td><td style="text-align:center">$</td></tr>')
        .replace('{{TOTAL_DUE}}', '7840');

    await page.setContent(html);
    await page.setViewportSize({ width: 816, height: 1056 }); // 8.5in * 96dpi
    await page.screenshot({ path: outputPath, fullPage: true });
    await browser.close();
    console.log(`Template snapshot saved to: ${outputPath}`);
}

snapshotTemplate().catch(console.error);
