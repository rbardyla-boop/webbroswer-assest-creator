import fs from 'node:fs';
import path from 'node:path';

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'knowledge';
}

export class KnowledgePlane {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  sync(state) {
    const accepted = Object.values(state.knowledge).filter(k => k.status === 'accepted');
    const expected = new Set();
    for (const item of accepted) {
      const filename = `${safeName(item.id)}--${safeName(item.title)}.md`;
      expected.add(filename);
      const provenance = (item.provenance || []).map(p => `- ${typeof p === 'string' ? p : JSON.stringify(p)}`).join('\n');
      const body = `---\nid: ${JSON.stringify(item.id)}\nstatus: accepted\nproposed_by: ${JSON.stringify(item.proposed_by)}\npromoted_by: ${JSON.stringify(item.promoted_by)}\npromoted_at: ${JSON.stringify(item.promoted_at)}\n---\n\n# ${item.title}\n\n${item.body}\n\n## Provenance\n\n${provenance || '- none'}\n`;
      fs.writeFileSync(path.join(this.directory, filename), body, 'utf8');
    }

    for (const filename of fs.readdirSync(this.directory)) {
      if (filename.endsWith('.md') && !expected.has(filename)) {
        fs.rmSync(path.join(this.directory, filename));
      }
    }
  }

  list(state) {
    return Object.values(state.knowledge).filter(k => k.status === 'accepted');
  }

  search(state, query) {
    const q = String(query || '').trim().toLowerCase();
    const items = this.list(state);
    if (!q) return items;
    return items.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.body.toLowerCase().includes(q) ||
      (item.provenance || []).some(p => JSON.stringify(p).toLowerCase().includes(q))
    );
  }
}
