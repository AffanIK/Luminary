import { createNote, getDailyNoteId, setDailyNoteId, getSettings, saveSettings } from '../shared/storage.js';
import { applyTemplate } from '../shared/templates.js';
import { todayString } from '../shared/notes-model.js';

// ─── Install ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await saveSettings({
      defaultColor: 'violet',
      sortBy: 'date',
      editorMode: 'split',
    });
    await ensureDailyNote();
  }
});

// ─── Commands ─────────────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-side-panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  }
});

// ─── Action click → open side panel ─────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  // If the popup is active this won't fire. But as a fallback:
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ─── Message bus ──────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ENSURE_DAILY_NOTE') {
    ensureDailyNote().then(id => sendResponse({ id }));
    return true;
  }

  if (msg.type === 'OPEN_SIDE_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) chrome.sidePanel.open({ windowId: tab.windowId });
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'RELAY') {
    // Relay a message from popup to side panel (broadcast)
    chrome.runtime.sendMessage(msg.payload).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});

// ─── Daily Note ───────────────────────────────────────────────────────────────

async function ensureDailyNote() {
  const today = todayString();
  const existing = await getDailyNoteId(today);
  if (existing) return existing;

  const fields = applyTemplate('daily');
  const note = await createNote(fields);
  await setDailyNoteId(today, note.id);
  return note.id;
}
