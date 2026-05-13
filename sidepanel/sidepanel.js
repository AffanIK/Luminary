import {
  getIndex, getNote, createNote, saveNote, deleteNote,
  archiveNote, pinNote, updateNoteColor,
  saveDraft, getDrafts,
  getSettings, saveSettings,
  getSortedNotes, getStorageUsage,
  getDailyNoteId, setDailyNoteId,
} from '../shared/storage.js';
import { applyTemplate } from '../shared/templates.js';
import { renderMarkdown, extractTitle, extractTags, renderCheckboxes } from '../shared/markdown-utils.js';
import { buildSearchIndex, search } from '../shared/search.js';
import { relativeTime, wordCount, todayString, COLOR_MAP } from '../shared/notes-model.js';

// ─── State ────────────────────────────────────────────────────────────────────
let allNotes = [];
let searchIndex = [];
let currentNote = null;
let currentFilter = 'all';
let currentSort = 'date';
let editorMode = 'split';
let showingPreview = false;
let autoSaveTimer = null;
let zenNote = null;

// ─── Views ────────────────────────────────────────────────────────────────────
const viewList   = document.getElementById('view-list');
const viewEditor = document.getElementById('view-editor');
const viewZen    = document.getElementById('view-zen');
const sidebar    = document.getElementById('sidebar');

// ─── Shared Elements ──────────────────────────────────────────────────────────
const spSearch     = document.getElementById('sp-search');
const clearSearch  = document.getElementById('btn-clear-search');
const tagCloud     = document.getElementById('tag-cloud');
const storageFill  = document.getElementById('sp-storage-fill');
const storagePct   = document.getElementById('sp-storage-pct');
const spToast      = document.getElementById('sp-toast');

// ─── List View Elements ───────────────────────────────────────────────────────
const notesGrid    = document.getElementById('notes-grid');
const emptyState   = document.getElementById('sp-empty-state');
const listTitle    = document.getElementById('list-title');
const sortSelect   = document.getElementById('sort-select');
const fabNew       = document.getElementById('fab-new');

// ─── Editor Elements ─────────────────────────────────────────────────────────
const noteTitle    = document.getElementById('note-title');
const noteContent  = document.getElementById('note-content');
const previewPane  = document.getElementById('preview-pane');
const previewCont  = document.getElementById('preview-content');
const editorBody   = document.getElementById('editor-body');
const statusWords  = document.getElementById('status-words');
const statusSaved  = document.getElementById('status-saved');
const btnDrafts    = document.getElementById('btn-drafts');
const draftsPanel  = document.getElementById('drafts-panel');
const draftsList   = document.getElementById('drafts-list');
const deleteConfirm= document.getElementById('delete-confirm');
const exportMenu   = document.getElementById('export-menu');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const settings = await getSettings();
  editorMode = settings.editorMode || 'split';
  currentSort = settings.sortBy || 'date';
  sortSelect.value = currentSort;

  await loadNotes();
  await loadStorageUsage();
  showView('list');
  animatePageLoad();
  bindEvents();

  // Listen for messages from popup / background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'NAVIGATE_TO_NOTE') openEditor(msg.noteId);
  });

  // Cross-device sync: refresh when another device updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (Object.keys(changes).some(k => k.startsWith('luminary_'))) {
      loadNotes().then(() => loadStorageUsage());
    }
  });

  // Ensure today's daily note exists
  chrome.runtime.sendMessage({ type: 'ENSURE_DAILY_NOTE' });
}

// ─── View Manager ─────────────────────────────────────────────────────────────
function showView(name) {
  viewList.classList.add('hidden');
  viewEditor.classList.add('hidden');
  viewZen.classList.add('hidden');

  if (name === 'list') {
    viewList.classList.remove('hidden');
    // Expand sidebar if collapsed only if we're going back to list
    if (sidebar.classList.contains('collapsed')) {
      gsap.to(sidebar, { width: 220, minWidth: 220, duration: 0.35, ease: 'power2.out' });
    }
  } else if (name === 'editor') {
    viewEditor.classList.remove('hidden');
  } else if (name === 'zen') {
    viewZen.classList.remove('hidden');
  }
}

// ─── Animations ───────────────────────────────────────────────────────────────
function animatePageLoad() {
  gsap.from(sidebar, { duration: 0.5, x: -220, opacity: 0, ease: 'power3.out' });
  gsap.from('.sidebar-logo, .sidebar-search, .nav-item, .tpl-btn', {
    duration: 0.4,
    x: -16,
    opacity: 0,
    stagger: 0.04,
    delay: 0.15,
    ease: 'power2.out',
  });
}

function animateCards(cards) {
  if (!cards.length) return;
  gsap.from(cards, {
    duration: 0.45,
    y: 36,
    opacity: 0,
    scale: 0.93,
    stagger: { amount: 0.35, from: 'start' },
    ease: 'back.out(1.4)',
    clearProps: 'all',
  });
}

function animateEditorOpen() {
  gsap.from(viewEditor, { duration: 0.4, x: '100%', opacity: 0, ease: 'power3.out', clearProps: 'all' });
  gsap.to(sidebar, { duration: 0.3, width: 54, minWidth: 54, ease: 'power2.inOut', delay: 0.05 });
  sidebar.classList.add('collapsed');
}

function animateEditorClose(cb) {
  gsap.to(viewEditor, { duration: 0.3, x: '8%', opacity: 0, ease: 'power2.in', onComplete: cb });
  gsap.to(sidebar, { duration: 0.4, width: 220, minWidth: 220, ease: 'power2.out', delay: 0.1 });
  sidebar.classList.remove('collapsed');
}

function animateZenEnter() {
  const tl = gsap.timeline();
  tl.to(sidebar, { duration: 0.3, x: -260, opacity: 0, ease: 'power2.in' })
    .to('.editor-toolbar', { duration: 0.25, y: -56, opacity: 0, ease: 'power2.in' }, '-=0.15')
    .to('.editor-statusbar', { duration: 0.2, y: 40, opacity: 0, ease: 'power2.in' }, '-=0.15')
    .to('.zen-textarea', { duration: 0.35, fontSize: '17px', lineHeight: '1.85', ease: 'power1.out' });
}

function animateZenExit(cb) {
  const tl = gsap.timeline({ onComplete: cb });
  tl.to('.zen-textarea', { duration: 0.25, fontSize: '14px', lineHeight: '1.7', ease: 'power1.in' })
    .to('.editor-toolbar', { duration: 0.3, y: 0, opacity: 1, ease: 'power2.out' }, '-=0.1')
    .to('.editor-statusbar', { duration: 0.3, y: 0, opacity: 1, ease: 'power2.out' }, '-=0.2')
    .to(sidebar, { duration: 0.35, x: 0, opacity: 1, ease: 'power3.out' }, '-=0.2');
}

function animateNoteCreate(card) {
  const fab = fabNew;
  const rect = fab.getBoundingClientRect();
  const ripple = document.createElement('div');
  ripple.className = 'create-ripple';
  document.body.appendChild(ripple);
  gsap.set(ripple, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, scale: 0, opacity: 0.7 });
  gsap.to(ripple, { scale: 12, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => ripple.remove() });

  gsap.from(card, { duration: 0.45, y: 60, scale: 0.85, opacity: 0, delay: 0.08, ease: 'back.out(1.7)', clearProps: 'all' });
}

function animateNoteDelete(card, cb) {
  gsap.to(card, {
    duration: 0.35,
    scale: 0.75,
    opacity: 0,
    rotation: -6,
    y: 16,
    ease: 'power2.in',
    onComplete: () => { card.remove(); cb && cb(); },
  });
}

function animateSavePulse() {
  if (!currentNote) return;
  const card = notesGrid.querySelector(`[data-id="${currentNote.id}"]`);
  if (!card) return;
  gsap.fromTo(card,
    { boxShadow: '0 0 0px rgba(167,139,250,0)' },
    { boxShadow: '0 0 28px rgba(167,139,250,0.55)', duration: 0.3, yoyo: true, repeat: 1, ease: 'power2.out' }
  );
}

function animateSearchFilter() {
  const cards = notesGrid.querySelectorAll('.note-card');
  gsap.from(cards, {
    duration: 0.3,
    scale: 0.95,
    opacity: 0,
    stagger: 0.04,
    ease: 'back.out(1.2)',
    clearProps: 'all',
  });
}

// ─── Notes Loading ────────────────────────────────────────────────────────────
async function loadNotes(filter = currentFilter) {
  currentFilter = filter;
  allNotes = await getSortedNotes(currentSort, filter === 'today' ? 'all' : filter);

  if (filter === 'today') {
    const todayId = await getDailyNoteId(todayString());
    allNotes = allNotes.filter(n => n.id === todayId || !n.archived);
  }

  searchIndex = buildSearchIndex(allNotes);
  renderNotes(allNotes);
  renderTagCloud();
}

function renderNotes(notes, animate = true) {
  notesGrid.querySelectorAll('.note-card').forEach(c => c.remove());

  if (!notes.length) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const cards = notes.map(note => {
    const card = buildCard(note);
    notesGrid.appendChild(card);
    return card;
  });

  if (animate) animateCards(cards);
}

function buildCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.id = note.id;
  card.dataset.color = note.color || 'violet';

  const tags = (note.tags || []).slice(0, 3)
    .map(t => `<span class="card-tag">#${t}</span>`).join('');

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">${esc(note.title || 'Untitled')}</div>
      ${note.pinned ? '<span class="card-pin">📌</span>' : ''}
    </div>
    ${note.preview ? `<div class="card-preview">${esc(note.preview)}</div>` : ''}
    <div class="card-footer">
      <div class="card-tags">${tags}</div>
      <span class="card-date">${relativeTime(note.updatedAt)}</span>
    </div>
  `;

  card.addEventListener('click', () => openEditor(note.id));
  return card;
}

function renderTagCloud() {
  const allTags = [...new Set(allNotes.flatMap(n => n.tags || []))];
  tagCloud.innerHTML = allTags.slice(0, 20).map(t =>
    `<button class="tag-chip" data-tag="${t}">#${t}</button>`
  ).join('');

  tagCloud.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tag;
      const filtered = allNotes.filter(n => n.tags.includes(tag));
      chip.classList.toggle('active');
      renderNotes(filtered);
      animateSearchFilter();
    });
  });
}

// ─── Storage Usage ────────────────────────────────────────────────────────────
async function loadStorageUsage() {
  try {
    const { used, quota } = await getStorageUsage();
    const pct = Math.min(100, Math.round((used / quota) * 100));
    storageFill.style.width = pct + '%';
    storagePct.textContent = pct + '%';
    if (pct > 80) storageFill.style.background = 'linear-gradient(90deg, #fbbf24, #fb7185)';
  } catch (_) {}
}

// ─── Editor ───────────────────────────────────────────────────────────────────
async function openEditor(noteId) {
  const note = await getNote(noteId);
  if (!note) return;

  currentNote = note;

  // Populate fields
  noteTitle.value = note.title || '';
  noteContent.value = note.content || '';

  // Color picker
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === note.color);
  });

  // Pin button
  document.getElementById('btn-pin').textContent = note.pinned ? '📌' : '📍';

  // Editor mode
  applyEditorMode(editorMode);
  updatePreview();
  updateWordCount();
  updateDraftCount(note.drafts?.length || 0);

  setStatusSaved(note.updatedAt);

  showView('editor');
  animateEditorOpen();

  // Focus textarea
  setTimeout(() => noteContent.focus(), 400);
}

function applyEditorMode(mode) {
  editorMode = mode;
  editorBody.classList.toggle('toggle-mode', mode === 'toggle');
  if (mode === 'toggle') {
    editorBody.classList.remove('show-preview');
    showingPreview = false;
    document.getElementById('btn-toggle-mode').classList.remove('active');
  }
}

function updatePreview() {
  const md = noteContent.value;
  const html = renderCheckboxes(renderMarkdown(md));
  previewCont.innerHTML = html;
}

function updateWordCount() {
  const wc = wordCount(noteContent.value);
  statusWords.textContent = `${wc} word${wc !== 1 ? 's' : ''}`;
  if (viewZen.classList.contains('hidden') === false) {
    document.getElementById('zen-wc').textContent = `${wc} words`;
  }
}

function setStatusSaved(ts) {
  statusSaved.classList.remove('saving', 'saved');
  statusSaved.textContent = ts ? `Saved ${relativeTime(ts)}` : 'Unsaved';
  if (ts) { statusSaved.classList.add('saved'); }
}

function updateDraftCount(count) {
  btnDrafts.textContent = `${count} draft${count !== 1 ? 's' : ''}`;
}

// ─── Auto-save ────────────────────────────────────────────────────────────────
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  statusSaved.classList.add('saving');
  statusSaved.classList.remove('saved');
  statusSaved.textContent = 'Typing…';
  autoSaveTimer = setTimeout(performSave, 1500);
}

async function performSave() {
  if (!currentNote) return;

  const content = noteContent.value;
  const title = noteTitle.value || extractTitle(content) || 'Untitled';
  const tags = extractTags(content);

  currentNote.title = title;
  currentNote.content = content;
  currentNote.tags = tags;

  await saveDraft(currentNote.id, content);
  await saveNote(currentNote);

  setStatusSaved(currentNote.updatedAt);
  updateDraftCount(currentNote.drafts?.length || 0);
  animateSavePulse();

  // Refresh list view card if it exists
  const card = notesGrid.querySelector(`[data-id="${currentNote.id}"]`);
  if (card) {
    card.querySelector('.card-title').textContent = title;
  }
}

// ─── Back to list ─────────────────────────────────────────────────────────────
function goBack() {
  clearTimeout(autoSaveTimer);
  if (currentNote) performSave();

  draftsPanel.classList.add('hidden');
  deleteConfirm.classList.add('hidden');
  exportMenu.classList.add('hidden');

  animateEditorClose(async () => {
    showView('list');
    await loadNotes();
    animateCards(Array.from(notesGrid.querySelectorAll('.note-card')));
  });
}

// ─── Zen Mode ─────────────────────────────────────────────────────────────────
function enterZen() {
  if (!currentNote) return;
  zenNote = currentNote;
  document.getElementById('zen-textarea').value = noteContent.value;
  document.getElementById('zen-title').textContent = noteTitle.value || 'Untitled';
  document.getElementById('zen-wc').textContent = `${wordCount(noteContent.value)} words`;

  showView('zen');
  animateZenEnter();
  setTimeout(() => document.getElementById('zen-textarea').focus(), 350);
}

function exitZen() {
  const zenTa = document.getElementById('zen-textarea');
  // Sync zen content back to editor
  noteContent.value = zenTa.value;
  updatePreview();
  updateWordCount();
  scheduleAutoSave();

  animateZenExit(() => {
    showView('editor');
    gsap.set(sidebar, { clearProps: 'all' });
    sidebar.classList.add('collapsed');
    gsap.set('.editor-toolbar', { clearProps: 'all' });
    gsap.set('.editor-statusbar', { clearProps: 'all' });
  });
}

// ─── Drafts ───────────────────────────────────────────────────────────────────
async function showDrafts() {
  if (!currentNote) return;
  const drafts = await getDrafts(currentNote.id);

  draftsList.innerHTML = '';
  if (!drafts.length) {
    draftsList.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:12px;">No drafts yet. Drafts save automatically every 1.5s of inactivity.</div>';
  } else {
    drafts.forEach((draft, i) => {
      const item = document.createElement('div');
      item.className = 'draft-item';
      item.innerHTML = `
        <div class="draft-time">${relativeTime(draft.savedAt)}${draft.truncated ? ' (truncated)' : ''}</div>
        <div class="draft-excerpt">${esc(draft.content.slice(0, 80))}…</div>
      `;
      item.addEventListener('click', () => restoreDraft(draft.content));
      draftsList.appendChild(item);
    });
  }

  draftsPanel.classList.toggle('hidden');
  if (!draftsPanel.classList.contains('hidden')) {
    gsap.from(draftsPanel, { duration: 0.25, y: 10, opacity: 0, ease: 'back.out(1.4)' });
  }
}

function restoreDraft(content) {
  noteContent.value = content;
  updatePreview();
  updateWordCount();
  scheduleAutoSave();
  draftsPanel.classList.add('hidden');
  showToast('Draft restored!');
}

// ─── New Note ─────────────────────────────────────────────────────────────────
async function newNote(templateKey = 'blank') {
  const fields = applyTemplate(templateKey);
  const settings = await getSettings();
  fields.color = fields.color || settings.defaultColor || 'violet';

  const note = await createNote(fields);
  allNotes.unshift(note.toIndexEntry ? { ...note } : note);

  // Show card briefly before opening editor
  const card = buildCard(note);
  notesGrid.prepend(card);
  animateNoteCreate(card);

  setTimeout(() => openEditor(note.id), 120);
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function showDeleteConfirm() {
  deleteConfirm.classList.toggle('hidden');
  exportMenu.classList.add('hidden');
}

async function confirmDelete() {
  if (!currentNote) return;
  const noteId = currentNote.id;
  deleteConfirm.classList.add('hidden');

  animateEditorClose(async () => {
    await deleteNote(noteId);
    currentNote = null;
    showView('list');
    await loadNotes();
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────
function copyMarkdown() {
  if (!currentNote) return;
  const md = `# ${currentNote.title}\n\n${noteContent.value}`;
  navigator.clipboard.writeText(md).then(() => showToast('Copied to clipboard!'));
  exportMenu.classList.add('hidden');
}

function downloadMarkdown() {
  if (!currentNote) return;
  const md = `# ${currentNote.title}\n\n${noteContent.value}`;
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentNote.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  exportMenu.classList.add('hidden');
  showToast('Downloaded!');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function openSettings() {
  const settings = await getSettings();
  document.getElementById('setting-color').value = settings.defaultColor || 'violet';
  document.getElementById('setting-editor').value = settings.editorMode || 'split';
  document.getElementById('setting-sort').value = settings.sortBy || 'date';
  document.getElementById('settings-modal').classList.remove('hidden');
  gsap.from('#settings-card', { duration: 0.3, scale: 0.92, opacity: 0, ease: 'back.out(1.6)' });
}

async function saveSettingsFromModal() {
  const settings = {
    defaultColor: document.getElementById('setting-color').value,
    editorMode: document.getElementById('setting-editor').value,
    sortBy: document.getElementById('setting-sort').value,
  };
  await saveSettings(settings);
  editorMode = settings.editorMode;
  currentSort = settings.sortBy;
  sortSelect.value = currentSort;
  document.getElementById('settings-modal').classList.add('hidden');
  showToast('Settings saved');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  spToast.textContent = msg;
  spToast.classList.remove('hidden');
  gsap.fromTo(spToast,
    { y: 60, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.4)',
      onComplete: () => {
        gsap.to(spToast, { y: 60, opacity: 0, delay: 2, duration: 0.25,
          onComplete: () => spToast.classList.add('hidden') });
      }
    }
  );
}

// ─── Search ───────────────────────────────────────────────────────────────────
function doSearch(q) {
  if (!q.trim()) {
    renderNotes(allNotes);
    clearSearch.classList.add('hidden');
    return;
  }
  clearSearch.classList.remove('hidden');
  const ids = search(q, searchIndex);
  const filtered = allNotes.filter(n => ids.includes(n.id));
  renderNotes(filtered, false);
  animateSearchFilter();
}

// ─── Event Bindings ───────────────────────────────────────────────────────────
function bindEvents() {

  // Sidebar
  document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    const collapsed = sidebar.classList.contains('collapsed');
    gsap.to(sidebar, { width: collapsed ? 54 : 220, minWidth: collapsed ? 54 : 220, duration: 0.3, ease: 'power2.inOut' });
  });

  // Nav filter buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      const labels = { all: 'All Notes', today: 'Today', pinned: 'Pinned', archived: 'Archived' };
      listTitle.textContent = labels[filter] || 'Notes';
      await loadNotes(filter);
      if (viewEditor.classList.contains('hidden') === false) {
        goBack();
      }
    });
  });

  // Template buttons
  document.querySelectorAll('.tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => newNote(btn.dataset.tpl));
  });

  // Sort
  sortSelect.addEventListener('change', async () => {
    currentSort = sortSelect.value;
    await loadNotes();
    animateCards(Array.from(notesGrid.querySelectorAll('.note-card')));
  });

  // FAB
  fabNew.addEventListener('click', () => newNote());

  // Search
  spSearch.addEventListener('input', (e) => doSearch(e.target.value));
  clearSearch.addEventListener('click', () => {
    spSearch.value = '';
    doSearch('');
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });
  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settings-modal')) {
      saveSettingsFromModal();
    }
  });
  document.getElementById('setting-color').addEventListener('change', saveSettingsFromModal);
  document.getElementById('setting-editor').addEventListener('change', saveSettingsFromModal);
  document.getElementById('setting-sort').addEventListener('change', saveSettingsFromModal);

  // Editor back
  document.getElementById('btn-back').addEventListener('click', goBack);

  // Note title input → auto-update
  noteTitle.addEventListener('input', scheduleAutoSave);

  // Note content → preview + auto-save
  noteContent.addEventListener('input', () => {
    updatePreview();
    updateWordCount();
    scheduleAutoSave();
  });

  // Ctrl+S manual save
  document.addEventListener('keydown', handleKeydown);

  // Color picker
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', async () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      if (currentNote) {
        currentNote.color = sw.dataset.color;
        await updateNoteColor(currentNote.id, sw.dataset.color);
        // Update card in grid
        const card = notesGrid.querySelector(`[data-id="${currentNote.id}"]`);
        if (card) card.dataset.color = sw.dataset.color;
      }
    });
  });

  // Pin
  document.getElementById('btn-pin').addEventListener('click', async () => {
    if (!currentNote) return;
    currentNote.pinned = !currentNote.pinned;
    await pinNote(currentNote.id, currentNote.pinned);
    document.getElementById('btn-pin').textContent = currentNote.pinned ? '📌' : '📍';
    showToast(currentNote.pinned ? 'Note pinned' : 'Note unpinned');
  });

  // Toggle editor mode
  document.getElementById('btn-toggle-mode').addEventListener('click', () => {
    if (editorMode === 'split') {
      editorMode = 'toggle';
      editorBody.classList.add('toggle-mode');
      document.getElementById('btn-toggle-mode').classList.add('active');
      document.getElementById('btn-toggle-mode').title = 'Show preview';
    } else {
      if (!showingPreview) {
        editorBody.classList.add('show-preview');
        showingPreview = true;
        document.getElementById('btn-toggle-mode').title = 'Show editor';
      } else {
        editorBody.classList.remove('show-preview');
        showingPreview = false;
        editorMode = 'split';
        editorBody.classList.remove('toggle-mode');
        document.getElementById('btn-toggle-mode').classList.remove('active');
        document.getElementById('btn-toggle-mode').title = 'Toggle split/preview';
      }
    }
  });

  // Zen mode
  document.getElementById('btn-zen').addEventListener('click', enterZen);
  document.getElementById('btn-exit-zen').addEventListener('click', exitZen);
  document.getElementById('zen-textarea').addEventListener('input', () => {
    const wc = wordCount(document.getElementById('zen-textarea').value);
    document.getElementById('zen-wc').textContent = `${wc} words`;
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('hidden');
    deleteConfirm.classList.add('hidden');
    draftsPanel.classList.add('hidden');
    if (!exportMenu.classList.contains('hidden')) {
      gsap.from(exportMenu, { duration: 0.2, y: -6, opacity: 0, ease: 'power2.out' });
    }
  });
  document.getElementById('btn-copy-md').addEventListener('click', copyMarkdown);
  document.getElementById('btn-download-md').addEventListener('click', downloadMarkdown);

  // Delete
  document.getElementById('btn-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirm();
    if (!deleteConfirm.classList.contains('hidden')) {
      gsap.from(deleteConfirm, { duration: 0.2, y: -6, opacity: 0, ease: 'back.out(1.4)' });
    }
  });
  document.getElementById('btn-confirm-delete').addEventListener('click', confirmDelete);
  document.getElementById('btn-cancel-delete').addEventListener('click', () => deleteConfirm.classList.add('hidden'));

  // Drafts
  btnDrafts.addEventListener('click', showDrafts);
  document.getElementById('btn-close-drafts').addEventListener('click', () => draftsPanel.classList.add('hidden'));

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!exportMenu.contains(e.target) && e.target.id !== 'btn-export') {
      exportMenu.classList.add('hidden');
    }
    if (!deleteConfirm.contains(e.target) && e.target.id !== 'btn-delete') {
      deleteConfirm.classList.add('hidden');
    }
    if (!draftsPanel.contains(e.target) && e.target.id !== 'btn-drafts') {
      draftsPanel.classList.add('hidden');
    }
  });
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────
function handleKeydown(e) {
  const ctrl = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    e.preventDefault();
    if (!viewZen.classList.contains('hidden')) { exitZen(); return; }
    if (!draftsPanel.classList.contains('hidden')) { draftsPanel.classList.add('hidden'); return; }
    if (!deleteConfirm.classList.contains('hidden')) { deleteConfirm.classList.add('hidden'); return; }
    if (!exportMenu.classList.contains('hidden')) { exportMenu.classList.add('hidden'); return; }
    if (!viewEditor.classList.contains('hidden')) { goBack(); return; }
  }

  if (ctrl && e.key === 'n') {
    e.preventDefault();
    if (!viewEditor.classList.contains('hidden')) return;
    newNote();
  }

  if (ctrl && e.key === 'f') {
    e.preventDefault();
    spSearch.focus();
  }

  if (ctrl && e.key === 's') {
    e.preventDefault();
    if (currentNote) performSave();
  }

  if (ctrl && e.shiftKey && e.key === 'Z') {
    e.preventDefault();
    if (!viewZen.classList.contains('hidden')) exitZen();
    else if (!viewEditor.classList.contains('hidden')) enterZen();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
