function makeTrigrams(str) {
  const set = new Set();
  const s = str.toLowerCase();
  for (let i = 0; i < s.length - 2; i++) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}

export function buildSearchIndex(indexEntries) {
  return indexEntries.map(n => ({
    id: n.id,
    corpus: [n.title, n.preview, n.tags.join(' ')].join(' ').toLowerCase(),
  }));
}

export function search(query, index) {
  const q = query.trim().toLowerCase();
  if (!q) return index.map(e => e.id);

  const words = q.split(/\s+/);
  const qTrigrams = makeTrigrams(q);

  return index
    .map(entry => {
      let score = 0;
      if (entry.corpus.includes(q)) score += 100;

      const wordHits = words.filter(w => entry.corpus.includes(w)).length;
      score += wordHits * 20;

      const entryTrigrams = makeTrigrams(entry.corpus);
      let overlap = 0;
      qTrigrams.forEach(t => { if (entryTrigrams.has(t)) overlap++; });
      if (qTrigrams.size > 0) score += (overlap / qTrigrams.size) * 30;

      return { id: entry.id, score };
    })
    .filter(e => e.score > 10)
    .sort((a, b) => b.score - a.score)
    .map(e => e.id);
}
