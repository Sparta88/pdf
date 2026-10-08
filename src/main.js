import './style.css';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { readForm, buildPdf, PROTECTED } from './pdfform.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// ---------------------------------------------------------------------------
// PRIVACY: tutto lo stato vive solo in queste variabili (RAM).
// Nessun localStorage / sessionStorage / IndexedDB / cookie / rete.
// ---------------------------------------------------------------------------
const state = {
  name: '',
  bytes: null,        // PDF originale, mai modificato
  info: null,         // Map nome campo -> {kind, value, ...}
  edits: new Map(),   // solo i campi toccati dall'utente
  zoom: 1,
  fit: 1
};

const $ = (id) => document.getElementById(id);
const els = {
  picker: $('filePicker'), empty: $('empty'), pages: $('pages'), main: $('main'),
  bar: $('bar'), topActions: $('topActions'), fileName: $('fileName'),
  flatten: $('flatten'), flattenHint: $('flattenHint'),
  save: $('saveBtn'), share: $('shareBtn'), close: $('closeDoc'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'),
  toast: $('toast'), busy: $('busy'), busyText: $('busyText')
};

const native = Capacitor.isNativePlatform();

// ----- Utilità UI ----------------------------------------------------------
let toastTimer;
function toast(msg, kind = '', ms = 5000) {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.className = 'toast ' + kind;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => (els.toast.hidden = true), ms);
}
function busy(on, text = 'Attendere…') {
  els.busyText.textContent = text;
  els.busy.hidden = !on;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function blobToBase64(bytes) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(new Blob([bytes], { type: 'application/pdf' }));
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function outName() {
  const base = state.name.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'documento';
  return `${base}-${els.flatten.checked ? 'bloccato' : 'compilato'}-${stamp()}.pdf`;
}

// ----- Apertura PDF --------------------------------------------------------
els.picker.addEventListener('change', async () => {
  const file = els.picker.files && els.picker.files[0];
  els.picker.value = ''; // dimentica subito il riferimento al file scelto
  if (!file) return;
  busy(true, 'Apertura del PDF…');
  await nextFrame();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openDocument(file.name, bytes);
  } catch (e) {
    console.error(e);
    resetDocument();
    const enc = /encrypt|password/i.test(String(e && (e.name + e.message)));
    toast(enc
      ? 'Questo PDF è protetto da password: non è supportato.'
      : 'Impossibile aprire il file. Controlla che sia un PDF valido.', 'err', 7000);
  } finally {
    busy(false);
  }
});

async function openDocument(name, bytes) {
  const info = await readForm(bytes); // fallisce se cifrato o non valido
  const loading = pdfjsLib.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    enableXfa: false,
    standardFontDataUrl: './pdfjs/standard_fonts/',
    cMapUrl: './pdfjs/cmaps/',
    cMapPacked: true
  });
  const pdf = await loading.promise;

  state.name = name;
  state.bytes = bytes;
  state.info = info;
  state.edits = new Map();
  state.zoom = 1;

  els.pages.replaceChildren();
  els.empty.hidden = true;
  els.pages.hidden = false;
  els.bar.hidden = false;
  els.topActions.hidden = false;
  els.fileName.textContent = name;
  els.fileName.hidden = false;
  els.flatten.checked = false;
  updateFlattenHint();

  const first = await pdf.getPage(1);
  const w1 = first.getViewport({ scale: 1 }).width;
  state.fit = Math.max(0.3, (document.documentElement.clientWidth - 16) / w1);
  applyZoom();

  let fieldCount = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = n === 1 ? first : await pdf.getPage(n);
    fieldCount += await renderPage(page, n, pdf.numPages);
  }
  await pdf.cleanup();

  if (info.size === 0 || fieldCount === 0) {
    toast('Questo PDF non ha campi compilabili: puoi leggerlo ma non scriverci sopra.', '', 8000);
  }
}

async function renderPage(page, n, total) {
  const vp = page.getViewport({ scale: 1 });
  const holder = document.createElement('div');
  holder.className = 'page';
  holder.style.setProperty('--w', vp.width);
  holder.style.setProperty('--h', vp.height);

  const canvas = document.createElement('canvas');
  const R = Math.min(3, Math.max(1.5, (window.devicePixelRatio || 1) * state.fit));
  const rvp = page.getViewport({ scale: R });
  canvas.width = Math.floor(rvp.width);
  canvas.height = Math.floor(rvp.height);
  holder.appendChild(canvas);
  els.pages.appendChild(holder);

  // I campi del modulo NON vengono disegnati nel canvas: li mostrano gli input HTML.
  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport: rvp,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS
  }).promise;

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `Pagina ${n} di ${total}`;
  holder.appendChild(label);

  let count = 0;
  const annots = await page.getAnnotations();
  for (const a of annots) {
    if (a.subtype !== 'Widget' || !a.fieldName) continue;
    if (PROTECTED.has(a.fieldName)) continue;
    const flags = a.annotationFlags || 0;
    if (flags & (2 | 32)) continue; // nascosto / non visibile
    const f = state.info.get(a.fieldName);
    if (!f) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (w < 4 || h < 4) continue; // campi "tecnici" invisibili

    const el = buildControl(a, f);
    if (!el) continue;
    el.classList.add('fld');
    el.style.setProperty('--x', x);
    el.style.setProperty('--y', y);
    el.style.setProperty('--fw', w);
    el.style.setProperty('--fh', h);
    el.style.setProperty('--fs', f.kind === 'text' && a.multiLine ? 11 : Math.max(7, Math.min(13, h * 0.55)));
    el.setAttribute('aria-label', a.alternativeText || a.fieldName);
    holder.appendChild(el);
    count++;
  }
  return count;
}

function buildControl(a, f) {
  const name = a.fieldName;
  const locked = !!(f.readOnly || a.readOnly);

  if (f.kind === 'text') {
    const el = document.createElement(a.multiLine ? 'textarea' : 'input');
    if (!a.multiLine) el.type = 'text';
    el.value = f.value;
    if (f.maxLength) el.maxLength = f.maxLength;
    el.disabled = locked;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'sentences');
    el.addEventListener('input', () => {
      state.edits.set(name, el.value);
      document.querySelectorAll('.fld').forEach((o) => {
        if (o !== el && o.dataset.field === name) o.value = el.value;
      });
    });
    el.dataset.field = name;
    return el;
  }

  if (f.kind === 'check') {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = !!f.value;
    el.disabled = locked;
    el.addEventListener('change', () => state.edits.set(name, el.checked));
    return el;
  }

  if (f.kind === 'radio') {
    const el = document.createElement('input');
    el.type = 'radio';
    el.name = 'r:' + name;
    const exportValue = a.buttonValue;
    el.checked = f.value === exportValue;
    el.disabled = locked;
    el.addEventListener('change', () => { if (el.checked) state.edits.set(name, exportValue); });
    return el;
  }

  if (f.kind === 'choice') {
    const el = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '';
    el.appendChild(empty);
    for (const o of f.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      el.appendChild(opt);
    }
    el.value = f.value;
    el.disabled = locked;
    el.addEventListener('change', () => state.edits.set(name, el.value));
    return el;
  }
  return null;
}

// ----- Zoom ----------------------------------------------------------------
function applyZoom() {
  els.pages.style.setProperty('--s', state.fit * state.zoom);
}
els.zoomIn.addEventListener('click', () => { state.zoom = Math.min(3, +(state.zoom + 0.25).toFixed(2)); applyZoom(); });
els.zoomOut.addEventListener('click', () => { state.zoom = Math.max(0.5, +(state.zoom - 0.25).toFixed(2)); applyZoom(); });

// ----- Opzione "Blocca il testo" ---------------------------------------------
function updateFlattenHint() {
  els.flattenHint.textContent = els.flatten.checked
    ? 'Acceso: testo fisso, il file non sarà più modificabile'
    : 'Spento: il file resta modificabile';
}
els.flatten.addEventListener('change', updateFlattenHint);

// ----- Salva / Condividi ------------------------------------------------------
async function makePdf() {
  const { bytes, warnings } = await buildPdf(state.bytes, state.edits, els.flatten.checked);
  return { bytes, warnings };
}

els.save.addEventListener('click', async () => {
  if (!state.bytes) return;
  busy(true, 'Creo il PDF…');
  await nextFrame();
  try {
    const { bytes, warnings } = await makePdf();
    const name = outName();
    const note = warnings.length ? '\n' + warnings.join('\n') : '';

    if (!native) {
      // Solo per prove da PC: scarica dal browser.
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('PDF scaricato.' + note, 'ok', 7000);
      return;
    }

    try { await Filesystem.requestPermissions(); } catch { /* Android recenti: non serve */ }
    const data = await blobToBase64(bytes);
    await Filesystem.writeFile({
      path: `PDF Compila/${name}`,
      data,
      directory: Directory.Documents,
      recursive: true
    });
    toast(`Salvato in Documenti/PDF Compila\n${name}${note}`, 'ok', 9000);
  } catch (e) {
    console.error(e);
    toast('Salvataggio non riuscito. Prova con "Condividi" e scegli dove salvare il file.', 'err', 9000);
  } finally {
    busy(false);
  }
});

els.share.addEventListener('click', async () => {
  if (!state.bytes) return;
  busy(true, 'Preparo la condivisione…');
  await nextFrame();
  try {
    const { bytes, warnings } = await makePdf();
    const name = outName();

    if (!native) {
      toast('La condivisione funziona solo nell\'app Android.', 'err');
      return;
    }
    const data = await blobToBase64(bytes);
    const path = `tmp/${name}`;
    await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    busy(false);
    await Share.share({ title: name, files: [uri], dialogTitle: 'Condividi il PDF' });
    if (warnings.length) toast(warnings.join('\n'), '', 8000);
  } catch (e) {
    // L'utente che chiude il menu di condivisione genera un errore: non va segnalato.
    if (!/cancel/i.test(String(e && e.message))) {
      console.error(e);
      toast('Condivisione non riuscita.', 'err');
    }
  } finally {
    busy(false);
  }
});

// ----- Chiudi documento: cancella tutto dalla memoria ----------------------------
function resetDocument() {
  state.bytes = null;
  state.info = null;
  state.edits = new Map();
  els.pages.replaceChildren();
  els.pages.hidden = true;
  els.empty.hidden = false;
  els.bar.hidden = true;
  els.topActions.hidden = true;
  els.fileName.hidden = true;
  els.fileName.textContent = '';
}
els.close.addEventListener('click', () => {
  if (state.edits.size && !confirm('Chiudere il documento? Quello che hai scritto e non salvato andrà perso.')) return;
  resetDocument();
  // Ricarica la pagina: svuota completamente la memoria usata dal documento.
  location.reload();
});

// ----- Pulizia dei file temporanei lasciati dalla condivisione -----------------------
(async function cleanTemp() {
  if (!native) return;
  try { await Filesystem.rmdir({ path: 'tmp', directory: Directory.Cache, recursive: true }); } catch { /* nessun file */ }
})();
