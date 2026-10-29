// Rolling on your own tables: a `table: [[Note#Heading]]` line in the block names a note, or a heading in it, and a
// roll picks from what is there. Pure functions over the note's text, like oracle.ts; main.ts reads the note.
//
//   | d6  | Weather    |      a lookup table: the first column holds numbers or ranges, the header names the dice
//   | 1-3 | Clear      |      (d6, 2d6, d20), or it is 1d(highest number)
//   | 4-6 | Fog        |
//
//   | Name | Trade |          any other table: one row, its cells joined; a Weight column makes some rows likelier
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
const WEIGHT = /^(weight|w)$/i;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?(.*\S)\s*$/;

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
		// a Weight column comes first: its numbers would otherwise read as d-ranges
		const w = t.headers.findIndex((h) => WEIGHT.test(h));
		if (w >= 0) {
			const weights = t.rows.map((r) => Math.max(0, Number(r[w]) || 0));
			const total = weights.reduce((a, b) => a + b, 0);
			let at = rng() * total;
			const row = total > 0 ? (t.rows.find((_, i) => (at -= weights[i]!) < 0) ?? t.rows[t.rows.length - 1]!) : pick(t.rows);
			return { text: row.filter((_, i) => i !== w).join(' | ') };
		}
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
	const items = listItems(text);
	if (items.length) return { text: pick(items) };
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !/^#{1,6}\s/.test(l) && !RULE.test(l) && !/^---+$/.test(l) && !l.startsWith('```'));
	return lines.length ? { text: pick(lines) } : null;
}

function listItems(text: string): string[] {
	return text
		.split('\n')
		.map((l) => ITEM.exec(l)?.[1])
		.filter((i): i is string => i !== undefined);
}

/** What kind of table the text holds, for the library: "d6", "weighted", "8 rows" or "12 items". Null for a single
 *  item or plain lines, so prose doesn't show up as a table. */
export function kindOf(text: string): string | null {
	const t = pipeTable(text);
	if (t && t.rows.length) {
		if (t.headers.some((h) => WEIGHT.test(h))) return 'weighted';
		const ranges = t.rows.map((r) => RANGE.exec(r[0] ?? ''));
		if (ranges.every(Boolean)) {
			const head = (t.headers[0] ?? '').trim().toLowerCase();
			return /^\d*d\d+$/.test(head) ? head : `d${Math.max(...ranges.map((m) => Number(m![2] ?? m![1])))}`;
		}
		return t.rows.length === 1 ? '1 row' : `${t.rows.length} rows`;
	}
	const items = listItems(text).length;
	return items >= 2 ? `${items} items` : null;
}

// Inside a result, {{2d6+1}} rolls dice and {{Note#Heading}} rolls on another table.
const INNER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const DICE = /^(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?$/i;

/** Fills in the {{...}} in a result. `roll` gives another table's result, or null to leave that one as it is. */
export async function expand(text: string, rng: Rng, roll: ((link: TableLink) => Promise<string | null>) | null): Promise<string> {
	const parts: string[] = [];
	let last = 0;
	for (const m of text.matchAll(INNER)) {
		parts.push(text.slice(last, m.index), await inner(m[0], m[1]!, rng, roll));
		last = m.index + m[0].length;
	}
	return parts.join('') + text.slice(last);
}

async function inner(whole: string, body: string, rng: Rng, roll: ((link: TableLink) => Promise<string | null>) | null) {
	const d = DICE.exec(body);
	if (d) {
		let n = 0;
		for (let i = 0; i < Number(d[1] || 1); i++) n += die(Number(d[2]), rng);
		return String(n + (d[3] === '-' ? -1 : 1) * Number(d[4] ?? 0));
	}
	const link = parseTableLink(body);
	return (link && roll && (await roll(link))) ?? whole;
}

/** Whether a result still holds a {{table}} left unrolled. */
export function hasInnerTable(text: string): boolean {
	return [...text.matchAll(INNER)].some((m) => !DICE.test(m[1]!));
}

export function journalTable(link: TableLink, r: TableRoll): string {
	return `- **${link.label}**${r.roll !== undefined ? ` *(${r.roll})*` : ''}: ${r.text}`;
}
