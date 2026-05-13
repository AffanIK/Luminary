import { Note, generateId, excerpt } from './notes-model.js';

const PREFIX = 'luminary_';
const INDEX_KEY = PREFIX + 'index';
const SETTINGS_KEY = PREFIX + 'settings';
const CHUNK_THRESHOLD = 7500;
const CHUNK_SIZE = 6000;
const MAX_DRAFT_CONTENT = 1800;
const MAX_DRAFTS = 3;

// ─── Helpers ────────────────────────────────────────────────────────────────

function noteKey(id)       { return `${PREFIX}note_${id}`; }
function chunkKey(id, n)   { return `${PREFIX}note_${id}_c${n}`; }
function dailyKey(date)    { return `${PREFIX}daily_${date}`; }

function byteLen(str) {
  return new TextEncoder().encode(JSON.stringify(str)).length;
}

async function syncGet(keys) {
  return new Promise((res, rej) => {
    chrome.storage.sync.get(keys, result => {
      if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
      else res(result);
    });
  });
}

async function syncSet(items) {
  return new Promise((res, rej) => {
    chrome.storage.sync.set(items, () => {
      if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
      else res();
    });
  });
}

async function syncRemove(keys) {
  return new Promise((res, rej) => {
    chrome.storage.sync.remove(keys, () => {
      if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
      else res();
    });
  });
}

// ─── Index ───────────────────────────────────────────────────────────────────

export async function getIndex() {
  const result = await syncGet(INDEX_KEY);
  return result[INDEX_KEY] || { notes: [] };
}

async function _saveIndex(index) {
  await syncSet({ [INDEX_KEY]: index });
}

export async function addToIndex(meta) {
  const index = await getIndex();
  index.notes.unshift(meta);
  await _saveIndex(index);
}

export async function updateIndexEntry(id, patch) {
  const index = await getIndex();
  const i = index.notes.findIndex(n => n.id === id);
  if (i !== -1) Object.assign(index.notes[i], patch);
  await _saveIndex(index);
}

export async function removeFromIndex(id) {
  const index = await getIndex();
  index.notes = index.notes.filter(n => n.id !== id);
  await _saveIndex(index);
}

// ─── Read / Write with chunking ──────────────────────────────────────────────

function splitChunks(content, size) {
  const chunks = [];
  for (let i = 0; i < content.length; i += size) {
    chunks.push(content.slice(i, i + size));
  }
  return chunks.length ? chunks : [''];
}

async function _writeNote(note) {
  const head = { ...note };
  const content = head.content;
  delete head.content;

  const serialized = JSON.stringify({ ...head, content });

  if (byteLen(serialized) <= CHUNK_THRESHOLD) {
    head.content = content;
    head.chunked = false;
    head.chunkCount = 1;
    await syncSet({ [noteKey(note.id)]: head });
    return;
  }

  // Chunked mode
  const chunks = splitChunks(content, CHUNK_SIZE);
  head.chunked = true;
  head.chunkCount = chunks.length;

  const items = { [noteKey(note.id)]: head };
  chunks.forEach((c, i) => { items[chunkKey(note.id, i)] = c; });
  await syncSet(items);
}

async function _readNote(id) {
  const result = await syncGet(noteKey(id));
  const head = result[noteKey(id)];
  if (!head) return null;

  if (!head.chunked) return head;

  const cKeys = Array.from({ length: head.chunkCount }, (_, i) => chunkKey(id, i));
  const cResult = await syncGet(cKeys);
  head.content = cKeys.map(k => cResult[k] || '').join('');
  return head;
}

async function _deleteNoteKeys(id, chunkCount = 1) {
  const keys = [noteKey(id)];
  if (chunkCount > 1) {
    for (let i = 0; i < chunkCount; i++) keys.push(chunkKey(id, i));
  }
  await syncRemove(keys);
}

// ─── Public CRUD ─────────────────────────────────────────────────────────────

export async function createNote(fields = {}) {
  const note = new Note(fields);
  await _writeNote(note);
  await addToIndex(note.toIndexEntry());
  return note;
}

export async function getNote(id) {
  const raw = await _readNote(id);
  if (!raw) return null;
  return new Note(raw);
}

export async function saveNote(note) {
  note.touch();
  await _writeNote(note);
  await updateIndexEntry(note.id, note.toIndexEntry());
}

export async function deleteNote(id) {
  const index = await getIndex();
  const entry = index.notes.find(n => n.id === id);
  const chunkCount = entry ? entry.chunkCount : 1;
  await _deleteNoteKeys(id, chunkCount);
  await removeFromIndex(id);
}

export async function archiveNote(id, archived = true) {
  const note = await getNote(id);
  if (!note) return;
  note.archived = archived;
  await saveNote(note);
}

export async function pinNote(id, pinned) {
  const note = await getNote(id);
  if (!note) return;
  note.pinned = pinned;
  await saveNote(note);
}

export async function updateNoteColor(id, color) {
  const note = await getNote(id);
  if (!note) return;
  note.color = color;
  await saveNote(note);
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

export async function saveDraft(id, content) {
  const note = await getNote(id);
  if (!note) return;
  const draft = {
    content: content.slice(0, MAX_DRAFT_CONTENT),
    savedAt: Date.now(),
    truncated: content.length > MAX_DRAFT_CONTENT,
  };
  note.drafts = [draft, ...(note.drafts || [])].slice(0, MAX_DRAFTS);
  await _writeNote(note);
}

export async function getDrafts(id) {
  const note = await getNote(id);
  return note ? (note.drafts || []) : [];
}

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  defaultColor: 'violet',
  sortBy: 'date',
  editorMode: 'split',
};

export async function getSettings() {
  const result = await syncGet(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

export async function saveSettings(settings) {
  await syncSet({ [SETTINGS_KEY]: settings });
}

// ─── Daily Note ───────────────────────────────────────────────────────────────

export async function getDailyNoteId(date) {
  const result = await syncGet(dailyKey(date));
  return result[dailyKey(date)] || null;
}

export async function setDailyNoteId(date, id) {
  await syncSet({ [dailyKey(date)]: id });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export async function getAllNotes() {
  const index = await getIndex();
  const ids = index.notes.map(n => n.id);
  const notes = await Promise.all(ids.map(id => getNote(id)));
  return notes.filter(Boolean);
}

export async function getStorageUsage() {
  return new Promise(res => {
    chrome.storage.sync.getBytesInUse(null, used => {
      res({ used, quota: chrome.storage.sync.QUOTA_BYTES });
    });
  });
}

export async function getSortedNotes(sortBy = 'date', filter = 'all') {
  const index = await getIndex();
  let notes = index.notes;

  if (filter === 'pinned')   notes = notes.filter(n => n.pinned && !n.archived);
  else if (filter === 'archived') notes = notes.filter(n => n.archived);
  else                        notes = notes.filter(n => !n.archived);

  if (sortBy === 'date') {
    notes = [
      ...notes.filter(n => n.pinned).sort((a, b) => b.updatedAt - a.updatedAt),
      ...notes.filter(n => !n.pinned).sort((a, b) => b.updatedAt - a.updatedAt),
    ];
  } else if (sortBy === 'color') {
    const order = ['violet','pink','cyan','green','amber','rose'];
    notes = notes.sort((a, b) => order.indexOf(a.color) - order.indexOf(b.color));
  } else if (sortBy === 'created') {
    notes = notes.sort((a, b) => b.createdAt - a.createdAt);
  }

  return notes;
}
