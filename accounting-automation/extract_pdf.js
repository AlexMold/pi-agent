const fs = require("fs");
const pdf = require("pdf-parse");

async function extractText() {
  let dataBuffer = fs.readFileSync("./Gamma_Code_march.pdf");
  try {
    const data = await pdf(dataBuffer);
    console.log("--- PDF Text Content ---");
    console.log(data.text);
    console.log("--- End of Content ---");
  } catch (err) {
    console.error("Error extracting PDF:", err);
  }
}

extractText();
