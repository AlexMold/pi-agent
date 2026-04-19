const { chromium } = require('playwright');
const path = require('path');

async function capturePdf() {
    const pdfPath = path.resolve('./Gamma_Code_march.pdf');
    const outputPath = path.resolve('./accounting-automation/pdf_visual.png');

    console.log(`Rendering PDF: ${pdfPath}...`);
    
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Playwright can open PDFs directly in the browser
    await page.goto(`file://${pdfPath}`, { waitUntil: 'networkidle' });
    
    // Set viewport to standard A4 ratio
    await page.setViewportSize({ width: 794, height: 1123 }); 
    
    await page.screenshot({ path: outputPath, fullPage: true });
    await browser.close();
    
    console.log(`Visual capture saved to: ${outputPath}`);
}

capturePdf().catch(console.error);
