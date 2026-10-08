// Eseguito dopo "npx cap add android".
// Rende l'app incapace di usare la rete e impedisce il backup automatico dei dati.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const path = 'android/app/src/main/AndroidManifest.xml';
let xml = readFileSync(path, 'utf8');

// 1) namespace "tools" (serve per forzare la rimozione di permessi aggiunti da librerie)
if (!xml.includes('xmlns:tools=')) {
  xml = xml.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ');
}

// 2) elimina il permesso INTERNET dichiarato dal template
xml = xml.replace(/\s*<uses-permission[^>]*android\.permission\.INTERNET[^>]*\/>/g, '');

// 3) forza la rimozione di INTERNET anche se una libreria lo dichiarasse
const permBlock = `
    <uses-permission android:name="android.permission.INTERNET" tools:node="remove" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
`;
xml = xml.replace(/<\/application>/, '</application>' + permBlock);

// 4) niente backup automatico su Google Drive / trasferimento dispositivo
if (/android:allowBackup="[^"]*"/.test(xml)) {
  xml = xml.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
} else {
  xml = xml.replace('<application', '<application android:allowBackup="false"');
}
xml = xml.replace(
  '<application',
  '<application android:fullBackupContent="false" android:dataExtractionRules="@xml/data_extraction_rules_none"'
);

writeFileSync(path, xml);

// regole "nessun dato" per Android 12+
mkdirSync('android/app/src/main/res/xml', { recursive: true });
writeFileSync(
  'android/app/src/main/res/xml/data_extraction_rules_none.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </device-transfer>
</data-extraction-rules>
`
);
console.log('AndroidManifest.xml modificato: niente INTERNET, niente backup.');
