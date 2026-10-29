import { describe, expect, it } from 'vitest';
import { csvCells, diceFor, freePath, importTable } from '../src/import';
import { rollOn } from '../src/tables';

describe('importing a table', () => {
	it('turns numbered lines into a lookup table with matching dice', () => {
		const t = importTable('1-2 Still and grey\n3–4: Fog off the water\n5-6. A storm | coming in')!;
		expect(t.kind).toBe('d6 table');
		expect(t.md).toBe('| d6 | Result |\n| --- | --- |\n| 1-2 | Still and grey |\n| 3-4 | Fog off the water |\n| 5-6 | A storm \\| coming in |');
		expect(rollOn(t.md, () => 0.99)).toEqual({ roll: 6, text: 'A storm | coming in' });
	});

	it('reads a numbered list as a die the size of the list', () => {
		expect(importTable('1. Rope\n2. Lamp oil\n3. Salt fish\n4. A map')!.kind).toBe('d4 table');
	});

	it('picks 2d6 for 2 to 12', () => {
		expect(diceFor(2, 12)).toBe('2d6');
		expect(diceFor(3, 18)).toBe('3d6');
		expect(diceFor(1, 20)).toBe('d20');
		expect(diceFor(2, 7)).toBe('d7');
	});

	it('turns CSV or tab separated text into a table with its header', () => {
		const t = importTable('Name,Trade\nMarra,"ferry, and rumours"\n"Old ""Bram""",smith')!;
		expect(t).toMatchObject({ kind: 'table, 2 columns', rows: 2 });
		expect(t.md).toBe('| Name | Trade |\n| --- | --- |\n| Marra | ferry, and rumours |\n| Old "Bram" | smith |');
		expect(importTable('Weight\tFind\n3\tRust\n1\tA ring')!.md).toBe('| Weight | Find |\n| --- | --- |\n| 3 | Rust |\n| 1 | A ring |');
	});

	it('makes a list of anything else, dropping bullets', () => {
		expect(importTable('• Marra\n- Aldous\n\nPetra, the smith\n')).toEqual({ md: '- Marra\n- Aldous\n- Petra, the smith', kind: 'list', rows: 3 });
		expect(importTable(' \n ')).toBeNull();
		expect(importTable('Marra, the ferrywoman\nAldous, the priest', true)).toMatchObject({ kind: 'list', rows: 2 });
	});

	it('splits CSV cells', () => {
		expect(csvCells('a, "b, c" ,d', ',')).toEqual(['a', 'b, c', 'd']);
	});

	it('finds a free note name', () => {
		const taken = new Set(['Tables/Loot.md']);
		expect(freePath('Tables', 'Loot', (p) => taken.has(p))).toBe('Tables/Loot 2.md');
		expect(freePath('', 'What? #1', () => false)).toBe('What 1.md');
	});
});
