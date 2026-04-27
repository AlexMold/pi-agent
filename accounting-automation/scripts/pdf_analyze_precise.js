const { convert } = require("@opendataloader/pdf");
const fs = require("fs");
const path = require("path");

async function analyzePdf() {
  try {
    const pdfPath = "/Users/agribcov/workplace/agent-exp-accounting/Gamma_Code_march.pdf";
    console.log(`Processing PDF: ${pdfPath}...`);

    // The convert function likely takes the path and options
    const result = await convert(pdfPath, { format: "html" });

    fs.writeFileSync(path.join(__dirname, "extracted_layout.html"), result);
    console.log("Successfully extracted layout to extracted_layout.html");
  } catch (error) {
    console.error("Error processing PDF:", error);
  }
}

analyzePdf();
