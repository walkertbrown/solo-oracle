// Exporting a game as a story (Pro): a copy of the note without the solo block, with the rolls the panel wrote
// either shortened to one italic line each or left out, so what is left reads as the story you played.

export type Rolls = 'short' | 'out';

const OPEN = /^((?:\s*>)*\s*)(`{3,}|~{3,})\s*solo\b/;
const ANSWER = /^\s*- \*\*\?\*\* (.*) \*\((.+?)\)\* → \*\*(.+)\*\*\s*$/;
const LABELED = /^\s*- \*\*(Twist|Words|Thread|Person):\*\* (.*\S)\s*$/;
const TABLE = /^\s*- \*\*(.+?)\*\*(?: \*\((\d+)\)\*)?: (.*\S)\s*$/;
const SCENE = /^\*(As expected\.|Not quite as expected: .*|Interrupted\. .*|Scene \d+ ends .*)\*\s*$/;

const stop = (t: string) => (/[.?!)]$/.test(t) ? t : t + '.');

/** One journal line as a short italic one, or null when it isn't a line the panel writes. */
function shorten(line: string): string | null {
	const a = ANSWER.exec(line);
	if (a) return a[1] === 'The oracle' ? `*The oracle: ${a[3]}.*` : `*${/[?!.]$/.test(a[1]!) ? a[1] : a[1] + '?'} ${a[3]}.*`;
	const l = LABELED.exec(line) ?? TABLE.exec(line);
	if (l) return `*${l[1]}: ${stop(l[l.length - 1]!)}*`;
	if (SCENE.test(line)) return line.trim();
	return null;
}

/** The story in a played note. */
export function story(note: string, rolls: Rolls): string {
	const lines = note.replace(/^---\n[\s\S]*?\n---(\n|$)/, '').split('\n');
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = OPEN.exec(lines[i]!);
		if (open) {
			const end = lines.findIndex((l, j) => j > i && l.includes(open[2]!));
			if (end > i) {
				i = end;
				continue;
			}
		}
		const short = shorten(lines[i]!);
		if (short === null) out.push(lines[i]!);
		else if (rolls === 'short') out.push(short);
	}
	return (
		out
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim() + '\n'
	);
}
