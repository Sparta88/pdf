// Copia font e cmap di pdf.js dentro public/ così finiscono nell'APK (nessun download da internet).
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('public/pdfjs', { recursive: true, force: true });
mkdirSync('public/pdfjs', { recursive: true });
cpSync('node_modules/pdfjs-dist/standard_fonts', 'public/pdfjs/standard_fonts', { recursive: true });
cpSync('node_modules/pdfjs-dist/cmaps', 'public/pdfjs/cmaps', { recursive: true });
console.log('Asset pdf.js copiati in public/pdfjs');
