const { convert } = require('@opendataloader/pdf');
const fs = require('fs');
const path = require('path');

async function analyzePdfDetailed() {
    try {
        const pdfPath = '/Users/agribcov/workplace/agent-exp-accounting/Gamma_Code_march.pdf';
        console.log(`Deep Processing PDF: ${pdfPath}...`);
        
        // Use 'json' format to get coordinates and font info
        const result = await convert(pdfPath, { format: 'json' }); 
        
        fs.writeFileSync(path.join(__dirname, 'extracted_layout.json'), result);
        console.log('Successfully extracted deep layout to extracted_layout.json');
    } catch (error) {
        console.error('Error processing PDF:', error);
    }
}

analyzePdfDetailed();
