/** JOBS is not imported; it is exported to JSON and Markdown instead. */
import { htmlToMarkdown } from './convert.js';

interface ArchiveIssue {
  sequence_id: number;
  name: string;
  state: string | null;
  priority: string;
  created_at: string;
  description_html: string | null;
  labels: string[];
  comments: { at: string; html: string }[];
  links: { title: string | null; url: string }[];
}
interface ArchivePage {
  name: string;
  description_html: string | null;
  created_at: string;
}

export function archiveToMarkdown(archive: Record<string, unknown>): string {
  const issues = (archive.issues ?? []) as ArchiveIssue[];
  const pages = (archive.pages ?? []) as ArchivePage[];
  const out = ['# JOBS archive', '', `${issues.length} work items, ${pages.length} workspace pages.`, ''];
  for (const i of issues) {
    out.push(`## JOBS-${i.sequence_id}: ${i.name}`, '');
    out.push(
      `State: ${i.state ?? 'none'}; priority: ${i.priority}; created ${new Date(i.created_at).toISOString()}`,
    );
    if (i.labels.length > 0) out.push(`Labels: ${i.labels.join(', ')}`);
    out.push('', htmlToMarkdown(i.description_html).markdown, '');
    for (const l of i.links) out.push(`- Link: [${l.title ?? l.url}](${l.url})`);
    for (const c of i.comments) {
      out.push('', `> Comment, ${new Date(c.at).toISOString()}`, '', htmlToMarkdown(c.html).markdown);
    }
    out.push('');
  }
  out.push('# Pages', '');
  for (const p of pages) {
    out.push(`## ${p.name || '(untitled)'}`, '', htmlToMarkdown(p.description_html).markdown, '');
  }
  return out.join('\n');
}
