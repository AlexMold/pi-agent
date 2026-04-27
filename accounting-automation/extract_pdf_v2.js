const pdf = require("pdf-parse");
const fs = require("fs");

async function run() {
  const dataBuffer = fs.readFileSync("./Gamma_Code_march.pdf");
  try {
    // Many versions of pdf-parse export the function directly
    // but some might export it as a property.
    const parseFn = typeof pdf === "function" ? pdf : pdf.parse;

    if (typeof parseFn !== "function") {
      console.error("Could not find a parse function in the pdf-parse module");
      console.log("Available keys:", Object.keys(pdf));
      return;
    }

    const data = await parseFn(dataBuffer);
    console.log(data.text);
  } catch (e) {
    console.error(e);
  }
}
run();
