import {
  getIndex, createNote, deleteNote, pinNote, getSortedNotes,
  getStorageUsage, getDailyNoteId, setDailyNoteId,
} from '../shared/storage.js';
import { applyTemplate } from '../shared/templates.js';
import { relativeTime, todayString } from '../shared/notes-model.js';
import { buildSearchIndex, search } from '../shared/search.js';

// ─── State ────────────────────────────────────────────────────────────────────
let allNotes = [];
let searchIndex = [];
let activeTemplate = 'blank';
let captureData = null;
let searchActive = false;
let newNoteActive = false;

// ─── Elements ─────────────────────────────────────────────────────────────────
const notesList     = document.getElementById('notes-list');
const emptyState    = document.getElementById('empty-state');
const searchBar     = document.getElementById('search-bar');
const searchInput   = document.getElementById('search-input');
const captureBar    = document.getElementById('capture-bar');
const capturePreview= document.getElementById('capture-preview');
const captureSource = document.getElementById('capture-source');
const newNoteBar    = document.getElementById('new-note-bar');
const newNoteInput  = document.getElementById('new-note-input');
const storageFill   = document.getElementById('storage-fill');
const storageLabel  = document.getElementById('storage-label');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  animateOpen();
  await loadNotes();
  await tryQuickCapture();
  await loadStorageUsage();
  bindEvents();
}

function animateOpen() {
  gsap.from('.glass-shell', {
    duration: 0.35,
    scale: 0.96,
    opacity: 0,
    ease: 'back.out(1.6)',
    transformOrigin: 'top center',
  });
}

// ─── Notes Loading ────────────────────────────────────────────────────────────
async function loadNotes() {
  const index = await getIndex();
  allNotes = index.notes.filter(n => !n.archived);
  searchIndex = buildSearchIndex(allNotes);
  renderNotes(allNotes);
}

function renderNotes(notes) {
  // Remove all existing cards
  notesList.querySelectorAll('.note-card').forEach(c => c.remove());

  if (!notes.length) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const cards = notes.map(note => {
    const card = buildCard(note);
    notesList.appendChild(card);
    return card;
  });

  gsap.from(cards, {
    duration: 0.4,
    y: 24,
    opacity: 0,
    scale: 0.94,
    stagger: { amount: 0.3, from: 'start' },
    ease: 'back.out(1.4)',
    clearProps: 'all',
  });
}

function buildCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.id = note.id;
  card.dataset.color = note.color || 'violet';

  const tags = (note.tags || []).slice(0, 3).map(t =>
    `<span class="tag-chip">#${t}</span>`
  ).join('');

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">${escHtml(note.title || 'Untitled')}</div>
      ${note.pinned ? '<span class="card-pin">📌</span>' : ''}
    </div>
    ${note.preview ? `<div class="card-preview">${escHtml(note.preview)}</div>` : ''}
    <div class="card-footer">
      <div class="card-tags">${tags}</div>
      <span class="card-date">${relativeTime(note.updatedAt)}</span>
    </div>
  `;

  card.addEventListener('click', () => openInPanel(note.id));
  return card;
}

// ─── Quick Capture ────────────────────────────────────────────────────────────
async function tryQuickCapture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        selection: window.getSelection().toString().trim(),
        url: location.href,
        title: document.title,
      }),
    });

    const data = results?.[0]?.result;
    if (data?.selection) {
      captureData = data;
      capturePreview.textContent = `"${data.selection.slice(0, 120)}${data.selection.length > 120 ? '…' : ''}"`;
      captureSource.textContent = `From: ${data.title || data.url}`;
      captureBar.classList.remove('hidden');

      gsap.from(captureBar, {
        duration: 0.3,
        y: -10,
        opacity: 0,
        ease: 'power2.out',
      });
    }
  } catch (_) {
    // Scripting fails on chrome:// pages or CSP-restricted pages — silently ignore
  }
}

async function saveClip() {
  if (!captureData) return;
  const fields = {
    title: `Clip: ${(captureData.title || 'Web Page').slice(0, 60)}`,
    content: `> ${captureData.selection}\n\n— [Source](${captureData.url})\n`,
    tags: ['clip'],
    color: 'cyan',
  };
  const note = await createNote(fields);
  showToast('Clip saved!');
  captureBar.classList.add('hidden');
  captureData = null;

  allNotes.unshift(note.toIndexEntry ? note.toIndexEntry() : note);
  await loadNotes();
}

// ─── New Note ─────────────────────────────────────────────────────────────────
function showNewNoteBar() {
  newNoteActive = true;
  newNoteBar.classList.remove('hidden');
  newNoteInput.value = '';
  newNoteInput.focus();

  gsap.from(newNoteBar, {
    duration: 0.25,
    height: 0,
    opacity: 0,
    ease: 'power2.out',
  });
}

function hideNewNoteBar() {
  newNoteActive = false;
  newNoteBar.classList.add('hidden');
}

async function createAndOpenNote() {
  const title = newNoteInput.value.trim();
  const fields = applyTemplate(activeTemplate);
  if (title) fields.title = title;

  const note = await createNote(fields);
  hideNewNoteBar();
  animateCardCreate();
  await loadNotes();
  openInPanel(note.id);
}

function animateCardCreate() {
  const btn = document.getElementById('btn-new');
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('div');
  ripple.className = 'create-ripple';
  document.body.appendChild(ripple);
  gsap.set(ripple, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, scale: 0, opacity: 0.7 });
  gsap.to(ripple, {
    scale: 10,
    opacity: 0,
    duration: 0.55,
    ease: 'power2.out',
    onComplete: () => ripple.remove(),
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────
function showSearch() {
  searchActive = true;
  searchBar.classList.remove('hidden');
  searchInput.focus();
  gsap.from(searchBar, { duration: 0.2, y: -8, opacity: 0, ease: 'power2.out' });
}

function hideSearch() {
  searchActive = false;
  searchBar.classList.add('hidden');
  searchInput.value = '';
  renderNotes(allNotes);
}

function doSearch(q) {
  if (!q.trim()) { renderNotes(allNotes); return; }
  const ids = search(q, searchIndex);
  const filtered = allNotes.filter(n => ids.includes(n.id));
  renderNotes(filtered);
}

// ─── Open in Side Panel ───────────────────────────────────────────────────────
function openInPanel(noteId) {
  chrome.runtime.sendMessage({ type: 'RELAY', payload: { type: 'NAVIGATE_TO_NOTE', noteId } });
  chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  window.close();
}

// ─── Storage Usage ────────────────────────────────────────────────────────────
async function loadStorageUsage() {
  try {
    const { used, quota } = await getStorageUsage();
    const pct = Math.min(100, Math.round((used / quota) * 100));
    storageFill.style.width = pct + '%';
    storageLabel.textContent = `${pct}%`;
    if (pct > 80) storageFill.style.background = 'linear-gradient(90deg, #fbbf24, #fb7185)';
  } catch (_) {}
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (searchActive) hideSearch();
    else if (newNoteActive) hideNewNoteBar();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'f') {
    e.preventDefault();
    showSearch();
  }
  if ((e.ctrlKey || e.metaKey) && key === 'n') {
    e.preventDefault();
    showNewNoteBar();
  }
  // Quick 'n' without modifier if not in an input
  if (key === 'n' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
    showNewNoteBar();
  }
});

// ─── Event Bindings ───────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-search').addEventListener('click', showSearch);
  document.getElementById('btn-clear-search').addEventListener('click', hideSearch);
  document.getElementById('btn-open-panel').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    window.close();
  });
  document.getElementById('btn-new').addEventListener('click', showNewNoteBar);
  document.getElementById('btn-save-clip').addEventListener('click', saveClip);

  searchInput.addEventListener('input', (e) => doSearch(e.target.value));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSearch(); });

  newNoteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createAndOpenNote();
    if (e.key === 'Escape') hideNewNoteBar();
  });

  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeTemplate = pill.dataset.tpl;
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  gsap.fromTo(toast,
    { y: 60, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.4)',
      onComplete: () => {
        gsap.to(toast, { y: 60, opacity: 0, delay: 1.5, duration: 0.25 });
      }
    }
  );
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
