const XLSX = require('xlsx');
const fs = require('fs');

const filePath = 'C:\\Users\\cburgos\\OneDrive - Tveez Colombia S.A\\Documentos\\BigData\\Global\\Analisis por dia todos los clientes\\ReportesDiarios.xlsx';

if (!fs.existsSync(filePath)) {
    console.log("File not found:", filePath);
    process.exit(1);
}

const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

console.log("Total rows found:", rawData.length);
console.log("Keys in first row:", Object.keys(rawData[0] || {}));
console.log("Keys in second row:", Object.keys(rawData[1] || {}));

const targetClient = "banco popular";
const targetUnit = "yulima";

const normalize = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

const sample = rawData.slice(1, 20);
console.log("Sample rows (first 20):");
sample.forEach((row, i) => {
    console.log(`Row ${i + 1}: Cliente=[${row['__EMPTY_2']}], Unidad=[${row['__EMPTY_3']}], Fecha=[${row['__EMPTY_1']}]`);
});

const matches = rawData.filter(row => {
    const c = normalize(row['__EMPTY_2']);
    const u = normalize(row['__EMPTY_3']);
    return c.includes(targetClient) || u.includes(targetUnit);
});

console.log("\nMatches found by simple includes (normalized):", matches.length);
if (matches.length > 0) {
    console.log("First 5 matches:");
    matches.slice(0, 5).forEach(m => {
        console.log(`Cliente: [${m['__EMPTY_2']}], Unidad: [${m['__EMPTY_3']}], Fecha: [${m['__EMPTY_1']}]`);
    });
}
