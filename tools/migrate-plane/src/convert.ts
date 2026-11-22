/** HTML to Markdown for Plane descriptions and comments (Turndown, plus GFM-style tables). */
import TurndownService from 'turndown';

export interface Converted {
  markdown: string;
  warnings: string[];
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

/** Plane stores some titles and names with HTML entities left in; decode the common ones. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

/** The little of the DOM that the table rule touches (the tsconfig has no DOM lib). */
interface Dom {
  textContent: string | null;
  children: ArrayLike<Dom>;
  querySelectorAll(selector: string): ArrayLike<Dom>;
}

function cellText(node: Dom): string {
  return (node.textContent ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function createService(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
    emDelimiter: '*',
  });
  td.keep(['sub', 'sup']);
  td.addRule('underline', { filter: ['u'], replacement: (content) => content });
  td.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from((node as unknown as Dom).querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const grid = rows.map((tr) => Array.from(tr.children).map((c) => cellText(c)));
      const width = Math.max(...grid.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill('')];
      const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
      const [head, ...body] = grid as [string[], ...string[][]];
      const sep = `| ${Array<string>(width).fill('---').join(' | ')} |`;
      return `\n\n${[line(head), sep, ...body.map(line)].join('\n')}\n\n`;
    },
  });
  return td;
}

const service = createService();

/** Tags that Markdown cannot express and which survived conversion. */
const LEFTOVER = /<(table|iframe|video|audio|svg|details|form|input|script|style)\b/i;

function hasNestedTable(html: string): boolean {
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)table\b/gi)) {
    depth += m[1] ? -1 : 1;
    if (depth > 1) return true;
  }
  return false;
}

export function htmlToMarkdown(html: string | null | undefined): Converted {
  const warnings: string[] = [];
  const source = (html ?? '').trim();
  if (source === '') return { markdown: '', warnings };
  let markdown = '';
  try {
    markdown = service.turndown(source).trim();
  } catch (err) {
    warnings.push(`conversion failed (${(err as Error).message}); kept the raw HTML`);
    return { markdown: source, warnings };
  }
  if (markdown === '') warnings.push('non-empty HTML converted to nothing');
  if (hasNestedTable(source)) warnings.push('nested tables flattened');
  if (/\b(colspan|rowspan)=/i.test(source)) warnings.push('table cells span rows or columns; spans lost');
  for (const m of source.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)) {
    const src = m[1] as string;
    if (!/^https?:\/\//i.test(src)) warnings.push(`image with relative source ${src}`);
  }
  const left = LEFTOVER.exec(markdown);
  if (left) warnings.push(`unconverted <${left[1]}> left in the Markdown`);
  return { markdown, warnings };
}
