// The table library (Pro): every table in a folder, found by its heading, to search and roll without a `table:` line.
// Pure over a note's text, like tables.ts; main.ts reads the vault and draws the view.

import { kindOf, type TableLink } from './tables';

export interface Found {
	file: string; // the note's path, "Tables/Names.md"
	folder: string; // "Tables", or "" at the vault's top
	note: string; // "Names"
	heading?: string; // none when the note has no headings and the whole note is the table
	kind: string; // "d6", "weighted", "8 rows", "12 items"
	text: string; // what is under the heading, for search
}

/** The tables in one note: each heading with a table or a list straight under it. A note without headings is one
 *  table, if it holds one. */
export function tablesIn(file: string, note: string): Found[] {
	const path = file.replace(/\.md$/, '');
	const at = path.lastIndexOf('/');
	const base = { file, folder: at < 0 ? '' : path.slice(0, at), note: path.slice(at + 1) };
	const out: Found[] = [];
	let heading: string | undefined;
	let body: string[] = [];
	const flush = () => {
		const text = body.join('\n');
		const kind = kindOf(text);
		if (kind) out.push({ ...base, heading, kind, text });
	};
	for (const l of note.replace(/^---\n[\s\S]*?\n---(\n|$)/, '').split('\n')) {
		const h = /^#{1,6}\s+(.*\S)\s*$/.exec(l);
		if (!h) {
			body.push(l);
			continue;
		}
		// what sits above the first heading is dropped: a link to the whole note would roll on everything in it
		if (heading !== undefined) flush();
		heading = h[1]!;
		body = [];
	}
	flush();
	return out;
}

/** The tables whose folder, note, heading or rows hold every word of `query`. */
export function search(all: Found[], query: string): Found[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return all.filter((f) => {
		const hay = `${f.file} ${f.heading ?? ''} ${f.text}`.toLowerCase();
		return words.every((w) => hay.includes(w));
	});
}

export function linkTo(f: Found): TableLink {
	return { path: f.file.replace(/\.md$/, ''), heading: f.heading, label: f.heading ?? f.note };
}

/** The `table:` line for a found table. */
export function linkText(f: Found): string {
	const l = linkTo(f);
	return `[[${l.path}${l.heading ? `#${l.heading}` : ''}]]`;
}
