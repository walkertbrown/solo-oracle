import { describe, expect, it } from 'vitest';
import {
	ODDS,
	addEntry,
	answerText,
	ask,
	journalAnswer,
	journalScene,
	parseSolo,
	removeEntry,
	setScene,
	setTension,
	startScene,
	twist,
	type Solo,
} from '../src/oracle';

// an rng that hands out these values in turn, as [0, 1)
const seq = (...v: number[]) => {
	let i = 0;
	return () => v[i++ % v.length]!;
};
// the value that makes die(sides) come up n
const face = (n: number, sides: number) => (n - 0.5) / sides;

const BODY = 'tension 3\nscene 2: The ferry\nthread: Find my brother\nnpc: Old Marra\nnpc: The Grey Captain\n# a note to self';

describe('reading a solo block', () => {
	it('reads tension, scene, threads and NPCs', () => {
		expect(parseSolo(BODY)).toEqual({
			tension: 3,
			scene: { n: 2, title: 'The ferry' },
			threads: ['Find my brother'],
			npcs: ['Old Marra', 'The Grey Captain'],
		});
	});

	it('starts at tension 2 and keeps tension in 0 to 6', () => {
		expect(parseSolo('').tension).toBe(2);
		expect(parseSolo('tension 9').tension).toBe(6);
		expect(parseSolo('Tension: -1').tension).toBe(0);
	});
});

describe('changing a solo block', () => {
	it('sets tension in place, or adds it at the top', () => {
		expect(setTension(BODY, 4).split('\n')[0]).toBe('tension 4');
		expect(setTension('thread: A', 1)).toBe('tension 1\nthread: A');
		expect(setTension('', 8)).toBe('tension 6\n');
	});

	it('sets the scene in place, or adds it under the tension', () => {
		expect(setScene(BODY, 3, 'The far shore').split('\n')[1]).toBe('scene 3: The far shore');
		expect(setScene('tension 2\nnpc: A', 1, 'Start')).toBe('tension 2\nscene 1: Start\nnpc: A');
		expect(setScene('npc: A', 1, '')).toBe('scene 1\nnpc: A');
	});

	it('adds an entry after the others of its kind and keeps other lines', () => {
		expect(addEntry(BODY, 'thread', '  Pay the  guild ')).toBe(BODY.replace('thread: Find my brother', 'thread: Find my brother\nthread: Pay the guild'));
		expect(addEntry('tension 2\n', 'npc', 'Ash')).toBe('tension 2\nnpc: Ash');
		expect(addEntry(BODY, 'npc', '  ')).toBe(BODY);
	});

	it('removes the nth entry of a kind only', () => {
		expect(parseSolo(removeEntry(BODY, 'npc', 0)).npcs).toEqual(['The Grey Captain']);
		expect(removeEntry(BODY, 'npc', 0)).toContain('# a note to self');
		expect(parseSolo(removeEntry(BODY, 'npc', 5)).npcs).toHaveLength(2);
	});
});

describe('the oracle', () => {
	const solo: Solo = { tension: 3, threads: ['Find my brother'], npcs: ['Old Marra'] };

	it('says yes at or under the odds and no over them', () => {
		expect(ask('Q', 'even', solo, seq(face(50, 100), face(10, 10))).yes).toBe(true);
		expect(ask('Q', 'even', solo, seq(face(51, 100), face(10, 10))).yes).toBe(false);
	});

	it('says "and" far from the line and "but" close to it', () => {
		const at = (roll: number) => answerText(ask('Q', 'likely', solo, seq(face(roll, 100), face(10, 10))));
		expect([1, 14, 15, 65, 66, 70, 71, 75, 76, 94, 95, 100].map(at)).toEqual([
			'Yes, and', 'Yes, and', 'Yes', 'Yes', 'Yes, but', 'Yes, but', 'No, but', 'No, but', 'No', 'No', 'No, and', 'No, and',
		]);
	});

	it('has every answer possible at every odds', () => {
		for (const o of ODDS) {
			const seen = new Set<string>();
			for (let r = 1; r <= 100; r++) seen.add(answerText(ask('Q', o.key, solo, seq(face(r, 100), face(10, 10)))));
			expect(seen.size, o.key).toBe(6);
		}
	});

	it('twists when the tension die is at or under the tension', () => {
		expect(ask('Q', 'even', solo, seq(face(40, 100), face(3, 10), 0, 0, 0)).twist).toBeDefined();
		expect(ask('Q', 'even', solo, seq(face(40, 100), face(4, 10))).twist).toBeUndefined();
		expect(ask('Q', 'even', { ...solo, tension: 0 }, seq(face(40, 100), face(1, 10))).twist).toBeUndefined();
	});

	it('names a thread or NPC in a twist, or something new when the list is empty', () => {
		// the second focus names an NPC
		const t = twist(solo, seq(1.5 / 12, 0, 0, 0));
		expect(t).toMatchObject({ focus: 'Someone you know acts', who: 'Old Marra' });
		expect(t.words).toHaveLength(2);
		expect(twist({ tension: 2, threads: [], npcs: [] }, seq(1.5 / 12, 0, 0))).toEqual({ focus: 'Someone new steps in', words: ['abandon', 'an ally'] });
		expect(twist({ tension: 2, threads: [], npcs: [] }, seq(4.5 / 12, 0, 0)).focus).toBe('A new thread begins');
	});

	it('writes an answer as a journal line', () => {
		const a = ask('Is the door locked?', 'likely', solo, seq(face(68, 100), face(2, 10), 4.5 / 12, 0, 0, 0));
		expect(journalAnswer(a)).toBe('- **?** Is the door locked? *(likely)* → **Yes, but**\n\t- **Twist:** A thread moves closer: Find my brother (abandon · an ally)');
	});
});

describe('scenes', () => {
	const solo: Solo = { tension: 3, scene: { n: 2, title: 'x' }, threads: [], npcs: ['Ash'] };

	it('numbers the next scene and keeps it as expected over the tension', () => {
		const s = startScene(' The far shore ', solo, seq(face(7, 10)));
		expect(s).toMatchObject({ n: 3, title: 'The far shore', result: 'expected' });
		expect(journalScene(s)).toBe('### Scene 3: The far shore\n\n*As expected.*');
	});

	it('changes the scene on an odd roll at or under the tension, interrupts it on an even one', () => {
		expect(startScene('A', solo, seq(face(3, 10), 0, 0)).result).toBe('changed');
		const s = startScene('A', solo, seq(face(2, 10), 1.5 / 12, 0, 0, 0));
		expect(s.result).toBe('interrupted');
		expect(journalScene(s)).toBe('### Scene 3: A\n\n*Interrupted. Someone you know acts: Ash (abandon · an ally).*');
	});
});
