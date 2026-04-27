const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

async function uploadTaxDocument(filePath) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Navigating to tax portal: ${process.env.TAX_PORTAL_URL}`);
    await page.goto(process.env.TAX_PORTAL_URL);

    // Login
    await page.fill('input[name="username"]', process.env.TAX_USER);
    await page.fill('input[name="password"]', process.env.TAX_PASS);
    await page.click('button[type="submit"]');

    // Navigate to upload section
    await page.click("text=Upload Documents");

    // Handle file upload
    const fileInput = await page.waitForSelector('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    console.log(`✅ Document ${filePath} attached.`);
    console.log("PLEASE REVIEW AND SUBMIT MANUALLY.");
  } catch (error) {
    console.error("Upload Error:", error);
  } finally {
    console.log("Browser open for manual submission.");
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: node upload_tax.js <filePath>");
    process.exit(1);
  }
  uploadTaxDocument(args[0]);
}
