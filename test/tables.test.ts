import { describe, expect, it } from 'vitest';
import { expand, hasInnerTable, journalTable, parseTableLink, rollOn, section } from '../src/tables';

const seq = (...v: number[]) => {
	let i = 0;
	return () => v[i++ % v.length]!;
};
const face = (n: number, sides: number) => (n - 0.5) / sides;

describe('table links', () => {
	it('reads a note, a heading and a label, with or without brackets', () => {
		expect(parseTableLink('[[Weather]]')).toEqual({ path: 'Weather', heading: undefined, label: 'Weather' });
		expect(parseTableLink('[[Tables/Weather#Coast]]')).toEqual({ path: 'Tables/Weather', heading: 'Coast', label: 'Coast' });
		expect(parseTableLink('[[Weather#Coast|Sky]]')).toEqual({ path: 'Weather', heading: 'Coast', label: 'Sky' });
		expect(parseTableLink('Tables/Names')!.label).toBe('Names');
		expect(parseTableLink('[[]]')).toBeNull();
		expect(parseTableLink('  ')).toBeNull();
	});
});

const NOTE = `---
tags: [tables]
---
# Weather

## Coast

| d6 | Sky |
| --- | --- |
| 1-3 | Clear |
| 4-5 | Fog rolls in |
| 6 | A storm |

### Notes on the coast

Kept with the coast.

## Inland

- Dry wind
- Hail

# Other`;

describe('the part of a note to roll on', () => {
	it('takes a heading up to the next one as high', () => {
		expect(section(NOTE, 'coast')).toContain('Kept with the coast.');
		expect(section(NOTE, 'Coast')).not.toContain('Hail');
		expect(section(NOTE, 'Inland')!.trim()).toBe('- Dry wind\n- Hail');
		expect(section(NOTE, 'Mountains')).toBeNull();
	});

	it('takes the whole note less its frontmatter', () => {
		expect(section(NOTE)).not.toContain('tags:');
		expect(section(NOTE)!.startsWith('# Weather')).toBe(true);
	});
});

describe('rolling on a table', () => {
	it('rolls the dice in a lookup table header and finds the row', () => {
		const coast = section(NOTE, 'Coast')!.split('###')[0]!;
		expect(rollOn(coast, seq(face(4, 6)))).toEqual({ roll: 4, text: 'Fog rolls in' });
		expect(rollOn(coast, seq(face(6, 6)))).toEqual({ roll: 6, text: 'A storm' });
	});

	it('adds up 2d6, and rolls 1d(top) when the header names no dice', () => {
		const t = '| 2d6 | Who |\n|---|---|\n| 2-6 | A guard |\n| 7-12 | A priest |';
		expect(rollOn(t, seq(face(3, 6), face(5, 6)))).toEqual({ roll: 8, text: 'A priest' });
		const u = '| Roll | Who |\n|---|---|\n| 1 | A guard |\n| 2-4 | A priest |';
		expect(rollOn(u, seq(face(2, 4)))).toEqual({ roll: 2, text: 'A priest' });
		expect(rollOn('| d8 | Who |\n|---|---|\n| 1-4 | A guard |', seq(face(7, 8)))).toEqual({ roll: 7, text: 'no row for that roll' });
	});

	it('picks a row of any other table, then a list item, then a line', () => {
		expect(rollOn('| Name | Trade |\n|---|---|\n| Ada | smith |\n| Bo | cook |', seq(0.9))).toEqual({ text: 'Bo | cook' });
		expect(rollOn(section(NOTE, 'Inland')!, seq(0.9))).toEqual({ text: 'Hail' });
		expect(rollOn('## Lines\n\nA crow\n\nA bell\n', seq(0.1))).toEqual({ text: 'A crow' });
		expect(rollOn('## Empty\n\n', seq(0))).toBeNull();
	});

	it('writes a roll as a journal line', () => {
		const link = parseTableLink('[[Weather#Coast]]')!;
		expect(journalTable(link, { roll: 4, text: 'Fog rolls in' })).toBe('- **Coast** *(4)*: Fog rolls in');
		expect(journalTable(link, { text: 'Hail' })).toBe('- **Coast**: Hail');
	});
});

describe('weights and what goes inside a result', () => {
	it('picks rows by a Weight column and leaves the column out', () => {
		const t = '| Weight | Find |\n|---|---|\n| 1 | A ring |\n| 3 | Rust |\n| 0 | Never |';
		expect(rollOn(t, () => 0.1)!.text).toBe('A ring'); // 0.4 of 4: inside the first 1
		expect(rollOn(t, () => 0.5)!.text).toBe('Rust');
		expect(rollOn(t, () => 0.999)!.text).toBe('Rust'); // the 0 row never comes up
	});

	it('rolls dice inside a result', async () => {
		expect(await expand('{{2d6+1}} rats', seq(0.5 / 6, 5.5 / 6), null)).toBe('8 rats');
		expect(await expand('{{d4-1}} coins', () => 0, null)).toBe('0 coins');
	});

	it('rolls a table inside a result, or leaves it when it cannot', async () => {
		const roll = async (l: { path: string; heading?: string }) => (l.heading === 'Goods' ? 'salt fish' : null);
		expect(await expand('A trader with {{Tables#Goods}}', () => 0, roll)).toBe('A trader with salt fish');
		expect(await expand('A trader with {{Tables#Nothing}}', () => 0, roll)).toBe('A trader with {{Tables#Nothing}}');
		expect(await expand('A trader with {{Tables#Goods}}', () => 0, null)).toBe('A trader with {{Tables#Goods}}');
	});

	it('knows when a table was left inside', () => {
		expect(hasInnerTable('a {{Goods}}')).toBe(true);
		expect(hasInnerTable('{{2d6}} rats')).toBe(false);
	});
});
