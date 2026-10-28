// The text side of Solo Oracle: reading a `solo` block, changing a line of it, and the oracle itself. No Obsidian
// here, so it is easy to test.
//
//   tension 2                     how tense the story is, 0 to 6; twists come more often as it rises
//   scene 3: The ferry at dusk    the scene being played
//   thread: Find my brother       something the story is about
//   npc: Old Marra                someone in it

export const TENSION_MIN = 0;
export const TENSION_MAX = 6;
export const TENSION_START = 2;

export type Rng = () => number;
export const die = (sides: number, rng: Rng) => 1 + Math.floor(rng() * sides);
const pick = <T>(list: readonly T[], rng: Rng): T => list[Math.floor(rng() * list.length)]!;

export interface Solo {
	tension: number;
	scene?: { n: number; title: string };
	threads: string[];
	npcs: string[];
}

export type ListKind = 'thread' | 'npc';

const TENSION = /^\s*tension\s*:?\s*(-?\d+)\s*$/i;
const SCENE = /^\s*scene\s+(\d+)\s*:?\s*(.*)$/i;
const ENTRY = /^\s*(thread|npc)\s*:\s*(.+?)\s*$/i;

export function parseSolo(body: string): Solo {
	const s: Solo = { tension: TENSION_START, threads: [], npcs: [] };
	for (const line of body.split('\n')) {
		let m: RegExpExecArray | null;
		if ((m = TENSION.exec(line))) s.tension = clampTension(Number(m[1]));
		else if ((m = SCENE.exec(line))) s.scene = { n: Number(m[1]), title: m[2]!.trim() };
		else if ((m = ENTRY.exec(line))) (m[1]!.toLowerCase() === 'thread' ? s.threads : s.npcs).push(m[2]!);
	}
	return s;
}

export const clampTension = (n: number) => Math.max(TENSION_MIN, Math.min(TENSION_MAX, Math.round(n)));

// Each change below keeps every line it doesn't own as written.

export function setTension(body: string, n: number): string {
	const line = `tension ${clampTension(n)}`;
	const lines = body.split('\n');
	const i = lines.findIndex((l) => TENSION.test(l));
	if (i >= 0) lines[i] = line;
	else lines.unshift(line);
	return lines.join('\n');
}

export function setScene(body: string, n: number, title: string): string {
	const line = `scene ${n}: ${title.trim()}`.trimEnd().replace(/:$/, '');
	const lines = body.split('\n');
	const i = lines.findIndex((l) => SCENE.test(l));
	if (i >= 0) lines[i] = line;
	else lines.splice(lines.findIndex((l) => TENSION.test(l)) + 1, 0, line);
	return lines.join('\n');
}

export function addEntry(body: string, kind: ListKind, text: string): string {
	const name = text.trim().replace(/\s+/g, ' ');
	if (!name) return body;
	const lines = body.split('\n');
	while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
	// after the last line of the same kind, so the lists stay together
	let at = -1;
	lines.forEach((l, i) => {
		const m = ENTRY.exec(l);
		if (m && m[1]!.toLowerCase() === kind) at = i;
	});
	lines.splice(at >= 0 ? at + 1 : lines.length, 0, `${kind}: ${name}`);
	return lines.join('\n');
}

/** Takes away the `index`th entry of that kind, counting from 0. */
export function removeEntry(body: string, kind: ListKind, index: number): string {
	let seen = -1;
	return body
		.split('\n')
		.filter((l) => {
			const m = ENTRY.exec(l);
			if (!m || m[1]!.toLowerCase() !== kind) return true;
			return ++seen !== index;
		})
		.join('\n');
}

// The oracle. A d100 against the odds answers yes or no. Close to the line it is "but", far from it "and". A d10 at
// or under the tension brings a twist.

export const ODDS = [
	{ key: 'sure', label: 'Sure thing', chance: 90 },
	{ key: 'likely', label: 'Likely', chance: 70 },
	{ key: 'even', label: 'Even', chance: 50 },
	{ key: 'unlikely', label: 'Unlikely', chance: 30 },
	{ key: 'long', label: 'Long shot', chance: 10 },
] as const;
export type OddsKey = (typeof ODDS)[number]['key'];

export interface Answer {
	question: string;
	odds: OddsKey;
	roll: number; // the d100
	yes: boolean;
	degree: 'and' | 'but' | '';
	tensionDie: number;
	twist?: Twist;
}

export function answerText(a: Pick<Answer, 'yes' | 'degree'>) {
	return `${a.yes ? 'Yes' : 'No'}${a.degree ? `, ${a.degree}` : ''}`;
}

export function ask(question: string, odds: OddsKey, solo: Solo, rng: Rng): Answer {
	const chance = ODDS.find((o) => o.key === odds)!.chance;
	const roll = die(100, rng);
	const yes = roll <= chance;
	// "and" in the outer fifth of its side; "but" within 5 of the line
	const and = yes ? roll <= Math.ceil(chance / 5) : roll > 100 - Math.ceil((100 - chance) / 5);
	const but = !and && (yes ? roll > chance - 5 : roll <= chance + 5);
	const tensionDie = die(10, rng);
	const a: Answer = { question: question.trim(), odds, roll, yes, degree: and ? 'and' : but ? 'but' : '', tensionDie };
	if (tensionDie <= solo.tension) a.twist = twist(solo, rng);
	return a;
}

// What a twist is about. `who` says which list it names; with that list empty it falls back to someone or something new.
const FOCUS: readonly { text: string; who?: ListKind }[] = [
	{ text: 'Someone new steps in' },
	{ text: 'Someone you know acts', who: 'npc' },
	{ text: 'Someone you know wants something', who: 'npc' },
	{ text: 'Someone you know is in trouble', who: 'npc' },
	{ text: 'A thread moves closer', who: 'thread' },
	{ text: 'A thread slips away', who: 'thread' },
	{ text: 'An old thread comes back', who: 'thread' },
	{ text: 'Something hidden comes out' },
	{ text: 'The place itself changes' },
	{ text: 'Luck turns your way, for now' },
	{ text: 'Things get worse' },
	{ text: 'A choice you made catches up' },
];

// Two words to read a twist by: something done, and what to. Plain words, picked for range.
export const ACTIONS = [
	'abandon', 'bargain', 'betray', 'block', 'break', 'build', 'capture', 'chase', 'claim', 'conceal', 'corrupt', 'deceive',
	'defend', 'delay', 'demand', 'destroy', 'discover', 'divide', 'escape', 'expose', 'fail', 'follow', 'free', 'guard',
	'heal', 'hunt', 'imitate', 'invade', 'join', 'judge', 'lose', 'mend', 'mourn', 'move', 'obey', 'offer', 'oppose',
	'poison', 'praise', 'protect', 'question', 'refuse', 'repay', 'rescue', 'return', 'reveal', 'ruin', 'search', 'seize',
	'share', 'steal', 'summon', 'surrender', 'test', 'threaten', 'trade', 'trap', 'trust', 'wake', 'warn',
] as const;
export const SUBJECTS = [
	'an ally', 'an ambition', 'an animal', 'an army', 'a bargain', 'a belief', 'a border', 'a burden', 'a child', 'a crowd',
	'a debt', 'a disguise', 'a door', 'a dream', 'a duty', 'an enemy', 'a family', 'a fear', 'a feast', 'a fire',
	'a friendship', 'a gift', 'a grave', 'a guide', 'a home', 'a hunger', 'an illness', 'a journey', 'a key', 'a law',
	'a leader', 'a letter', 'a lie', 'a map', 'a memory', 'a message', 'a monster', 'a name', 'an oath', 'a path',
	'a power', 'a prisoner', 'a promise', 'a rival', 'a road', 'a ruin', 'a rumour', 'a secret', 'a shelter', 'a signal',
	'a storm', 'a stranger', 'a symbol', 'a tool', 'a treasure', 'a truth', 'a vehicle', 'a wall', 'a weapon', 'a wound',
] as const;

export interface Twist {
	focus: string;
	who?: string; // the thread or NPC it names
	words: [string, string];
}

export const words = (rng: Rng): [string, string] => [pick(ACTIONS, rng), pick(SUBJECTS, rng)];

export function twist(solo: Solo, rng: Rng): Twist {
	const f = pick(FOCUS, rng);
	const list = f.who === 'npc' ? solo.npcs : f.who === 'thread' ? solo.threads : [];
	if (f.who && !list.length) return { focus: f.who === 'npc' ? 'Someone new steps in' : 'A new thread begins', words: words(rng) };
	return { focus: f.text, who: f.who ? pick(list, rng) : undefined, words: words(rng) };
}

export function twistText(t: Twist) {
	return `${t.focus}${t.who ? `: ${t.who}` : ''} (${t.words.join(' · ')})`;
}

// A new scene: you say what you expect, and a d10 against the tension may change it. Odd changes the scene, even
// interrupts it with a twist.

export interface SceneStart {
	n: number;
	title: string;
	roll: number;
	result: 'expected' | 'changed' | 'interrupted';
	change?: [string, string];
	twist?: Twist;
}

export function startScene(title: string, solo: Solo, rng: Rng): SceneStart {
	const n = (solo.scene?.n ?? 0) + 1;
	const roll = die(10, rng);
	const s: SceneStart = { n, title: title.trim(), roll, result: 'expected' };
	if (roll > solo.tension) return s;
	if (roll % 2) return { ...s, result: 'changed', change: words(rng) };
	return { ...s, result: 'interrupted', twist: twist(solo, rng) };
}

export function sceneText(s: SceneStart) {
	if (s.result === 'expected') return 'As expected.';
	if (s.result === 'changed') return `Not quite as expected: change one thing (${s.change!.join(' · ')}).`;
	return `Interrupted. ${twistText(s.twist!)}.`;
}

// The lines written into the note's journal.

export function journalAnswer(a: Answer) {
	const label = ODDS.find((o) => o.key === a.odds)!.label.toLowerCase();
	const q = a.question || 'The oracle';
	const lines = [`- **?** ${q} *(${label})* → **${answerText(a)}**`];
	if (a.twist) lines.push(`	- **Twist:** ${twistText(a.twist)}`);
	return lines.join('\n');
}

export function journalScene(s: SceneStart) {
	return `### Scene ${s.n}${s.title ? `: ${s.title}` : ''}\n\n*${sceneText(s)}*`;
}
