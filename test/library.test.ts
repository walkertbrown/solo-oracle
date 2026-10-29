import { describe, expect, it } from 'vitest';
import { linkText, linkTo, search, tablesIn } from '../src/library';
import { kindOf } from '../src/tables';

const NOTE = `---
tags: tables
---
Tables for the coast.

- not a table: it sits above the first heading

## Weather

| d6 | Sky |
| --- | --- |
| 1-3 | Clear |
| 4-6 | Fog |

## Finds

| Weight | Find |
| --- | --- |
| 1 | A ring |
| 3 | Rust |

### Names

- Marra
- Aldous
- Petra

## Notes

Just some prose about the coast.
`;

describe('what kind of table', () => {
	it('names lookup, weighted, plain tables and lists, and skips prose', () => {
		expect(kindOf('| 2d6 | x |\n|---|---|\n| 2-7 | a |\n| 8-12 | b |')).toBe('2d6');
		expect(kindOf('| # | x |\n|---|---|\n| 1-4 | a |\n| 5-8 | b |')).toBe('d8');
		expect(kindOf('| W | x |\n|---|---|\n| 1 | a |')).toBe('weighted');
		expect(kindOf('| Name | Trade |\n|---|---|\n| a | b |\n| c | d |')).toBe('2 rows');
		expect(kindOf('- a\n- b\n- c')).toBe('3 items');
		expect(kindOf('- just one')).toBeNull();
		expect(kindOf('Some prose.\nMore prose.')).toBeNull();
	});
});

describe('the tables in a note', () => {
	it('finds each heading with a table or list under it', () => {
		const found = tablesIn('Tables/Coast.md', NOTE);
		expect(found.map((f) => [f.heading, f.kind])).toEqual([
			['Weather', 'd6'],
			['Finds', 'weighted'],
			['Names', '3 items'],
		]);
		expect(found[0]).toMatchObject({ file: 'Tables/Coast.md', folder: 'Tables', note: 'Coast' });
	});

	it('takes a note with no headings as one table', () => {
		const [f] = tablesIn('Names.md', '- Marra\n- Aldous\n');
		expect(f).toMatchObject({ folder: '', note: 'Names', heading: undefined, kind: '2 items' });
		expect(linkText(f!)).toBe('[[Names]]');
		expect(linkTo(f!)).toEqual({ path: 'Names', heading: undefined, label: 'Names' });
	});

	it('links to the heading by the note path', () => {
		const f = tablesIn('Tables/Coast.md', NOTE)[1]!;
		expect(linkText(f)).toBe('[[Tables/Coast#Finds]]');
		expect(linkTo(f).label).toBe('Finds');
	});
});

describe('search', () => {
	const all = [...tablesIn('Tables/Coast.md', NOTE), ...tablesIn('Tables/Town/Names.md', '- Bram\n- Ilse\n')];
	it('matches every word, in the path, the heading or the rows', () => {
		expect(search(all, '').length).toBe(4);
		expect(search(all, 'rust').map((f) => f.heading)).toEqual(['Finds']);
		expect(search(all, 'town').map((f) => f.note)).toEqual(['Names']);
		expect(search(all, 'coast fog').map((f) => f.heading)).toEqual(['Weather']);
		expect(search(all, 'coast bram')).toEqual([]);
	});
});
