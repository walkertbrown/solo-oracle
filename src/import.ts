// Importing a table (Pro): text pasted from a PDF or a spreadsheet, or a .csv file, turned into Markdown the
// library and the panel can roll on.
//
//   1-2 Still and grey         numbered lines: a lookup table, with dice to match the numbers (2-12 is 2d6)
//   name,trade                 comma or tab separated: a table, the first row its header
//   Marra                      anything else: a list, one item a line

const NUMBERED = /^(\d+)(?:\s*[-–]\s*(\d+))?\s*[.):]?\s+(.*\S)$/;
const BULLET = /^(?:[-*+•]|\d+[.)])\s+/;

export interface Imported {
	md: string;
	kind: string; // what it reads as, to show before it is added: "d6 table", "table, 3 columns", "list"
	rows: number;
}

/** Splits one line of CSV, with quoted cells ("a, b" and "" for a quote). */
export function csvCells(line: string, sep: string): string[] {
	const out: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i]!;
		if (quoted) {
			if (c === '"' && line[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"' && !cell.trim()) {
			quoted = true;
			cell = '';
		} else if (c === sep) {
			out.push(cell.trim());
			cell = '';
		} else cell += c;
	}
	out.push(cell.trim());
	return out;
}

const cell = (c: string) => c.replace(/\|/g, '\\|');
const row = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`;
const rule = (n: number) => `|${' --- |'.repeat(n)}`;

/** The dice that roll from `low` to `high`: 1-6 is d6, 2-12 is 2d6, 3-18 is 3d6. */
export function diceFor(low: number, high: number): string {
	return low > 1 && high % low === 0 ? `${low}d${high / low}` : `d${high}`;
}

/** Markdown for pasted text, or null when there is nothing in it. `list` keeps every line an item, for lines that
 *  happen to hold commas. */
export function importTable(raw: string, list = false): Imported | null {
	const lines = raw
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (!lines.length) return null;

	const nums = lines.map((l) => NUMBERED.exec(l));
	if (!list && nums.every(Boolean) && lines.length > 1) {
		const low = Math.min(...nums.map((m) => Number(m![1])));
		const high = Math.max(...nums.map((m) => Number(m![2] ?? m![1])));
		const dice = diceFor(low, high);
		const body = nums.map((m) => row([m![2] ? `${m![1]}-${m![2]}` : m![1]!, m![3]!]));
		return { md: [row([dice, 'Result']), rule(2), ...body].join('\n'), kind: `${dice} table`, rows: lines.length };
	}

	for (const sep of list ? [] : ['\t', ',', ';']) {
		const rows = lines.map((l) => csvCells(l, sep));
		const n = rows[0]!.length;
		if (n < 2 || lines.length < 2 || !rows.every((r) => r.length === n)) continue;
		return { md: [row(rows[0]!), rule(n), ...rows.slice(1).map(row)].join('\n'), kind: `table, ${n} columns`, rows: rows.length - 1 };
	}

	const items = lines.map((l) => l.replace(BULLET, ''));
	return { md: items.map((i) => `- ${i}`).join('\n'), kind: 'list', rows: items.length };
}

/** A note path in `folder` named `name` that isn't taken: "Tables/Loot.md", then "Tables/Loot 2.md". */
export function freePath(folder: string, name: string, taken: (path: string) => boolean): string {
	const dir = folder.replace(/^\/+|\/+$/g, '');
	const base = (name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Table');
	for (let i = 1; ; i++) {
		const path = `${dir ? dir + '/' : ''}${base}${i > 1 ? ` ${i}` : ''}.md`;
		if (!taken(path)) return path;
	}
}
