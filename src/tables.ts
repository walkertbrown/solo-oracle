// Rolling on your own tables: a `table: [[Note#Heading]]` line in the block names a note, or a heading in it, and a
// roll picks from what is there. Pure functions over the note's text, like oracle.ts; main.ts reads the note.
//
//   | d6  | Weather    |      a lookup table: the first column holds numbers or ranges, the header names the dice
//   | 1-3 | Clear      |      (d6, 2d6, d20), or it is 1d(highest number)
//   | 4-6 | Fog        |
//
//   | Name | Trade |          any other table: one row, its cells joined
//   - A wolf                  a list: one item
//   Plain lines               otherwise: one non-empty line

import { die, type Rng } from './oracle';

export interface TableLink {
	path: string; // the link as written: "Note" or "Folder/Note"
	heading?: string;
	label: string; // the alias, the heading or the note's name
}

/** Reads `[[Note#Heading|Label]]`, or the same without brackets. Null when there is no note name. */
export function parseTableLink(text: string): TableLink | null {
	const m = /^\s*(?:\[\[)?([^\]|#^]*?)\s*(?:#([^\]|]+?))?\s*(?:\|([^\]]+?))?\s*(?:\]\])?\s*$/.exec(text);
	const path = m?.[1]?.trim();
	if (!m || !path) return null;
	const heading = m[2]?.trim() || undefined;
	return { path, heading, label: m[3]?.trim() || heading || path.split('/').pop()! };
}

/** The part of a note under `heading` (up to the next heading as high or higher), or the whole note less its
 *  frontmatter. Null when the heading isn't there. */
export function section(note: string, heading?: string): string | null {
	const lines = note.replace(/^---\n[\s\S]*?\n---(\n|$)/, '').split('\n');
	if (!heading) return lines.join('\n');
	const level = (l: string) => /^(#{1,6})\s/.exec(l)?.[1]!.length ?? 0;
	const want = heading.toLowerCase();
	const at = lines.findIndex((l) => level(l) > 0 && l.replace(/^#+\s+/, '').trim().toLowerCase() === want);
	if (at < 0) return null;
	const end = lines.findIndex((l, i) => i > at && level(l) > 0 && level(l) <= level(lines[at]!));
	return lines.slice(at + 1, end < 0 ? undefined : end).join('\n');
}

export interface TableRoll {
	text: string;
	roll?: number; // the number rolled on a lookup table
}

const RULE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const RANGE = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/;

function pipeTable(text: string): { headers: string[]; rows: string[][] } | null {
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.startsWith('|'));
	if (lines.length < 2 || !RULE.test(lines[1]!)) return null;
	const cells = (l: string) =>
		l
			.replace(/^\|/, '')
			.replace(/\|$/, '')
			.split(/(?<!\\)\|/)
			.map((c) => c.replace(/\\\|/g, '|').trim());
	return { headers: cells(lines[0]!), rows: lines.slice(2).map(cells).filter((r) => r.some((c) => c)) };
}

/** One roll on the text under a table link. Null when there is nothing to roll on. */
export function rollOn(text: string, rng: Rng): TableRoll | null {
	const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)]!;
	const t = pipeTable(text);
	if (t && t.rows.length) {
		const ranges = t.rows.map((r) => RANGE.exec(r[0] ?? ''));
		if (ranges.every(Boolean)) {
			const dice = /^\s*(\d*)d(\d+)\s*$/i.exec(t.headers[0] ?? '');
			const top = Math.max(...ranges.map((m) => Number(m![2] ?? m![1])));
			let roll = 0;
			if (dice) for (let i = 0; i < Number(dice[1] || 1); i++) roll += die(Number(dice[2]), rng);
			else roll = die(top, rng);
			const i = ranges.findIndex((m) => roll >= Number(m![1]) && roll <= Number(m![2] ?? m![1]));
			return { roll, text: i < 0 ? 'no row for that roll' : t.rows[i]!.slice(1).join(' | ') };
		}
		return { text: pick(t.rows).join(' | ') };
	}
	const items: string[] = [];
	for (const l of text.split('\n')) {
		const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?(.*\S)\s*$/.exec(l);
		if (m) items.push(m[1]!);
	}
	if (items.length) return { text: pick(items) };
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !/^#{1,6}\s/.test(l) && !RULE.test(l) && !/^---+$/.test(l) && !l.startsWith('```'));
	return lines.length ? { text: pick(lines) } : null;
}

export function journalTable(link: TableLink, r: TableRoll): string {
	return `- **${link.label}**${r.roll !== undefined ? ` *(${r.roll})*` : ''}: ${r.text}`;
}
