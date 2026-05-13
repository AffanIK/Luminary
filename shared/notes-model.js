export const COLOR_OPTIONS = ['violet', 'pink', 'cyan', 'green', 'amber', 'rose'];

export const COLOR_MAP = {
  violet: { accent: '#a78bfa', glow: 'rgba(167,139,250,0.35)', bg: 'rgba(167,139,250,0.08)' },
  pink:   { accent: '#f472b6', glow: 'rgba(244,114,182,0.35)', bg: 'rgba(244,114,182,0.08)' },
  cyan:   { accent: '#67e8f9', glow: 'rgba(103,232,249,0.35)', bg: 'rgba(103,232,249,0.08)' },
  green:  { accent: '#4ade80', glow: 'rgba(74,222,128,0.35)',  bg: 'rgba(74,222,128,0.08)'  },
  amber:  { accent: '#fbbf24', glow: 'rgba(251,191,36,0.35)',  bg: 'rgba(251,191,36,0.08)'  },
  rose:   { accent: '#fb7185', glow: 'rgba(251,113,133,0.35)', bg: 'rgba(251,113,133,0.08)' },
};

export function generateId() {
  return `lmn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function excerpt(content, maxLen = 120) {
  return content
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>#\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export class Note {
  constructor(fields = {}) {
    this.id         = fields.id         || generateId();
    this.title      = fields.title      || 'Untitled';
    this.content    = fields.content    || '';
    this.tags       = fields.tags       || [];
    this.color      = fields.color      || 'violet';
    this.pinned     = fields.pinned     || false;
    this.archived   = fields.archived   || false;
    this.createdAt  = fields.createdAt  || Date.now();
    this.updatedAt  = fields.updatedAt  || Date.now();
    this.chunked    = fields.chunked    || false;
    this.chunkCount = fields.chunkCount || 1;
    this.drafts     = fields.drafts     || [];
  }

  toIndexEntry() {
    return {
      id:         this.id,
      title:      this.title,
      preview:    excerpt(this.content, 120),
      tags:       this.tags,
      color:      this.color,
      pinned:     this.pinned,
      archived:   this.archived,
      createdAt:  this.createdAt,
      updatedAt:  this.updatedAt,
      chunked:    this.chunked,
      chunkCount: this.chunkCount,
    };
  }

  touch() {
    this.updatedAt = Date.now();
  }
}

export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7)  return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function todayString() {
  return new Date().toISOString().slice(0, 10);
}
