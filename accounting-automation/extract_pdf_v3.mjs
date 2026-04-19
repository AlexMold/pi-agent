import pdf from 'pdf-parse/lib/pdf-parse.js';
import fs from 'fs';

async function run() {
    const dataBuffer = fs.readFileSync('./Gamma_Code_march.pdf');
    try {
        const data = await pdf(dataBuffer);
        console.log(data.text);
    } catch (e) {
        console.error(e);
    }
}
run();
