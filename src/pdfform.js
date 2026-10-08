// Logica sui moduli PDF (nessuna dipendenza dal DOM, quindi testabile da Node).
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  StandardFonts
} from 'pdf-lib';

// Campi che l'app non mostra e non modifica mai (identificano il foglio nella pratica).
export const PROTECTED = new Set(['codice']);

const safe = (fn, fallback) => {
  try { return fn(); } catch { return fallback; }
};

/** Legge tipo e valore iniziale di ogni campo del modulo. */
export async function readForm(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const info = new Map();
  for (const f of doc.getForm().getFields()) {
    const name = f.getName();
    if (f instanceof PDFTextField) {
      info.set(name, {
        kind: 'text',
        value: safe(() => f.getText(), '') ?? '',
        maxLength: safe(() => f.getMaxLength(), undefined),
        readOnly: safe(() => f.isReadOnly(), false)
      });
    } else if (f instanceof PDFCheckBox) {
      info.set(name, { kind: 'check', value: safe(() => f.isChecked(), false), readOnly: safe(() => f.isReadOnly(), false) });
    } else if (f instanceof PDFRadioGroup) {
      info.set(name, { kind: 'radio', value: safe(() => f.getSelected(), '') ?? '', readOnly: safe(() => f.isReadOnly(), false) });
    } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
      info.set(name, {
        kind: 'choice',
        options: safe(() => f.getOptions(), []),
        value: safe(() => f.getSelected()[0], '') ?? '',
        readOnly: safe(() => f.isReadOnly(), false)
      });
    }
    // pulsanti e firme digitali: ignorati
  }
  return info;
}

function pageIndexOfField(doc, field) {
  const pages = doc.getPages();
  const widget = safe(() => field.acroField.getWidgets()[0], null);
  const p = widget && safe(() => widget.P(), null);
  if (p) {
    const i = pages.findIndex((pg) => pg.ref === p || pg.ref.toString() === p.toString());
    if (i >= 0) return i;
  }
  return 0;
}

/**
 * Crea il PDF compilato.
 * @param bytes   PDF originale (non viene mai modificato)
 * @param edits   Map nome campo -> nuovo valore (solo campi toccati dall'utente)
 * @param flatten true = testo "bloccato" (campi non più modificabili)
 * @returns {{bytes: Uint8Array, warnings: string[]}}
 */
export async function buildPdf(bytes, edits, flatten) {
  const warnings = [];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const cleanText = (name, text) => {
    let out = '';
    let replaced = false;
    for (const ch of String(text).replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
      if (ch === '\n') { out += ch; continue; }
      try { font.encodeText(ch); out += ch; } catch { out += '?'; replaced = true; }
    }
    if (replaced) warnings.push(`Nel campo "${name}" alcuni caratteri speciali non sono supportati dal PDF e sono stati sostituiti con "?".`);
    return out;
  };

  for (const [name, value] of edits) {
    if (PROTECTED.has(name)) continue;
    const field = safe(() => form.getField(name), null);
    if (!field) continue;
    if (field instanceof PDFTextField) {
      const t = cleanText(name, value);
      field.setText(t === '' ? undefined : t);
    } else if (field instanceof PDFCheckBox) {
      value ? field.check() : field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      value ? field.select(value) : field.clear();
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      value ? field.select(value) : field.clear();
    }
  }

  form.updateFieldAppearances(font);

  if (flatten) {
    // flatten() elimina tutti i campi, anche quello protetto: lo ricreo identico e invisibile.
    const keep = [];
    for (const name of PROTECTED) {
      const f = safe(() => form.getTextField(name), null);
      if (f) keep.push({ name, value: safe(() => f.getText(), '') ?? '', page: pageIndexOfField(doc, f) });
    }
    form.flatten();
    for (const k of keep) {
      const tf = form.createTextField(k.name);
      tf.setText(k.value);
      tf.enableReadOnly();
      tf.addToPage(doc.getPage(k.page), { x: 0, y: 0, width: 1, height: 1, borderWidth: 0 });
    }
  }

  const out = await doc.save({ updateFieldAppearances: false });
  return { bytes: out, warnings };
}
