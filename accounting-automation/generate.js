const fs = require("fs");
const playwright = require("playwright");
const path = require("path");

/**
 * Generates a Hyper-Precise PDF invoice for Gamma Code.
 * Matches exact coordinates from the original PDF.
 */
async function generateInvoice(data) {
  const { poNumber, clientName, clientAddress, items } = data;

  // 1. Invoice ID (00051 format)
  const lastIdFile = path.join(__dirname, "last_id.json");
  let lastId = 0;
  if (fs.existsSync(lastIdFile)) {
    lastId = JSON.parse(fs.readFileSync(lastIdFile, "utf8")).id;
  }
  const newId = lastId + 1;
  const formattedId = newId.toString().padStart(5, "0");

  // 2. Date (DD.MM.YYYY)
  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, "0")}.${(now.getMonth() + 1).toString().padStart(2, "0")}.${now.getFullYear()}`;

  // 3. Table and Totals
  let totalDue = 0;
  let currencySymbol = "$";

  // Original template has 6 rows in the screenshot. We fill the data and leave rest empty.
  let tableRowsHtml = "";
  for (let i = 0; i < 6; i++) {
    const item = items[i];
    if (item) {
      const itemTotal = item.quantity * item.unitPrice;
      totalDue += itemTotal;
      currencySymbol = item.currency || "$";
      tableRowsHtml += `
                <tr>
                    <td style="text-align: center">${item.quantity}</td>
                    <td>${item.description}</td>
                    <td style="text-align: right">${item.unitPrice}</td>
                    <td style="text-align: right">${itemTotal}</td>
                    <td style="text-align: center">${currencySymbol}</td>
                </tr>
            `;
    } else {
      tableRowsHtml += `<tr><td></td><td></td><td></td><td></td><td></td></tr>`;
    }
  }

  // 4. Fill Template
  let template = fs.readFileSync(path.join(__dirname, "invoice-template.html"), "utf8");
  const html = template
    .replace("{{INVOICE_ID}}", formattedId)
    .replace("{{PO_NUMBER}}", poNumber)
    .replace("{{DATE}}", dateStr)
    .replace("{{CLIENT_NAME}}", clientName)
    .replace("{{CLIENT_ADDRESS}}", clientAddress)
    .replace("{{TABLE_ROWS}}", tableRowsHtml)
    .replace("{{TOTAL_DUE}}", `${totalDue}`); // Matches "TOTAL DUE 7856" style

  // 5. Render
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);

  const pdfName = `Invoice_GC_${formattedId}.pdf`;
  const pdfPath = path.join(__dirname, pdfName);

  // Use Letter size (612pt x 792pt)
  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" }
  });

  await browser.close();
  fs.writeFileSync(lastIdFile, JSON.stringify({ id: newId }));

  console.log(`✅ Hyper-Precise Invoice Generated: ${pdfName}`);
  return pdfPath;
}

if (require.main === module) {
  generateInvoice({
    poNumber: "VAUB8091",
    clientName: "Vauban Technologies LTD",
    clientAddress: "186 Shoreditch High Street London, GB-LND E1 6HU United Kingdom",
    items: [
      { quantity: 1, description: "Software development services", unitPrice: 7840, currency: "$" },
      { quantity: 2, description: "Bank fee", unitPrice: 16, currency: "$" }
    ]
  }).catch(console.error);
}
