const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function performTransfer(amount, recipientIban, reference) {
    const browser = await chromium.launch({ 
        headless: false, // Set to false so you can handle MFA/2FA
        args: ['--start-maximized'] 
    });
    
    // Use stealth to avoid bank bot detection
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log(`Navigating to bank: ${process.env.BANK_URL}`);
        await page.goto(process.env.BANK_URL);

        // --- HARDWARE KEY PHASE ---
        console.log('🔒 HARDWARE KEY REQUIRED');
        console.log('1. Please plug in your USB Cryptographic Key.');
        console.log('2. Enter your credentials and USB PIN in the bank/OS prompt.');
        
        // We wait for the dashboard to appear, indicating a successful hardware login
        console.log('Waiting for successful login detection...');
        await page.waitForURL('**/dashboard', { timeout: 300000 }); // 5 minute timeout for user action

        console.log('✅ Login detected! AI taking control to prepare the transfer...');

        // --- TRANSFER PHASE ---
        console.log('Navigating to transfer page...');
        await page.click('text=Make a Transfer'); // Example selector
        
        await page.fill('input[name="amount"]', amount);
        await page.fill('input[name="iban"]', recipientIban);
        await page.fill('input[name="reference"]', reference);

        console.log('✅ Transfer form prepared.');
        console.log('STOPPING HERE. Please verify the details and click "Confirm" manually.');
        
        // We do NOT click the final submit button for security reasons.
        // The human must be the final gate.
        
    } catch (error) {
        console.error('Automation Error:', error);
    } finally {
        // Keep browser open for human confirmation
        console.log('Browser remains open for your confirmation.');
    }
}

// CLI Support
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.log('Usage: node bank_transfer.js <amount> <iban> <reference>');
        process.exit(1);
    }
    performTransfer(args[0], args[1], args[2]);
}
