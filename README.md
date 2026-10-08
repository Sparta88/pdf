# PDF Compila

App Android per compilare moduli PDF (campi AcroForm) **offline**, senza account e senza server.

## Cosa fa
- Apre un PDF dalla memoria del telefono (selettore file di Android).
- Mostra le pagine e ti fa scrivere nei campi compilabili (testo, caselle, scelte).
- Salva una **copia** in `Documenti/PDF Compila` (l'originale non viene mai toccato).
- Condivide il file dal menu di Android: Bluetooth, email, ecc.
- Interruttore **"Blocca il testo"**:
  - spento → il PDF resta modificabile (campi ancora compilabili);
  - acceso → il testo diventa fisso (consigliato per stampa e invio).
- Il campo nascosto `codice`, il QR e il codice a piè di pagina non vengono mai modificati,
  neppure con "Blocca il testo".

## Privacy: cosa garantisce il progetto
- L'APK viene costruito **senza il permesso INTERNET** (lo script `scripts/patch-android.js` lo rimuove e il
  workflow fallisce se lo trova nell'APK finale). L'app non può trasmettere nulla in rete.
- Nessun `localStorage`, `sessionStorage`, `IndexedDB`, cookie o database: i dati scritti stanno solo in memoria
  finché il documento è aperto. "Chiudi" ricarica l'app e svuota tutto.
- Backup automatico di Android disattivato.
- Nessuna analitica e nessuna libreria di terze parti che contatti server.
- Su disco finisce solo il PDF che scegli di salvare (e una copia temporanea in cache quando usi "Condividi",
  cancellata all'avvio successivo).

Limiti onesti: la tastiera del telefono (es. Gboard) può imparare le parole digitate, impostazione che dipende
dal telefono (usa la modalità incognito della tastiera se serve). Il file salvato o condiviso resta sul telefono /
arriva al destinatario.

## Come ottenere l'APK con GitHub (senza installare nulla sul PC)
1. Crea un account su github.com (gratuito) e un nuovo repository **privato**, es. `pdf-compila`.
2. Carica tutti i file di questa cartella nel repository, mantenendo le cartelle
   (`.github`, `scripts`, `src`, ...). Dal sito: *Add file → Upload files*, trascina il contenuto della cartella.
   Attenzione: la cartella `.github` è nascosta, assicurati che sia stata caricata (deve esistere
   `.github/workflows/build-apk.yml`). In alternativa usa `git push`.
3. Vai nella scheda **Actions**. Il workflow "Crea APK Android" parte da solo a ogni caricamento
   (oppure premi *Run workflow*). Dura circa 5-10 minuti.
4. A fine lavoro apri l'esecuzione e scarica da **Artifacts** il file `PDF-Compila-apk` (è uno zip con dentro `PDF-Compila.apk`).
5. Copia `PDF-Compila.apk` sul telefono, aprilo e consenti l'installazione da "fonti sconosciute" quando richiesto.

L'APK è firmato con la chiave di debug di Android: va benissimo per uso personale.

## Sviluppo su PC (facoltativo)
```
npm install
npm run dev        # prova nel browser (il salvataggio scarica il file)
npm run build      # compila in dist/
```
Per l'APK in locale servono Node 20, Java 17 e Android Studio: ripeti i passi del workflow
(`npx cap add android`, `node scripts/patch-android.js`, `npx cap sync android`, `./gradlew assembleDebug` in `android/`).

## Struttura
- `src/main.js` interfaccia, apertura, salvataggio, condivisione
- `src/pdfform.js` lettura e scrittura dei campi del PDF (pdf-lib)
- `scripts/patch-android.js` rimuove INTERNET e backup
- `.github/workflows/build-apk.yml` costruzione automatica dell'APK

## Limiti noti
- PDF protetti da password e moduli XFA non sono supportati.
- L'app non modifica il testo già stampato nel PDF, solo i campi compilabili.
- I caratteri fuori dall'alfabeto latino esteso (es. emoji) non sono supportati nei campi e diventano "?".
- Non è stato possibile provare l'APK su un telefono reale durante la creazione: la parte web è stata collaudata
  nel browser con il PDF di esempio; il salvataggio in Documenti e la condivisione vanno verificati al primo avvio.
