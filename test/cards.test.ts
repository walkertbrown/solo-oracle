import { describe, expect, it } from 'vitest';
import { DECK, cardName, draw, drawn, journalCard, shuffle, withCard } from '../src/cards';
import { story } from '../src/story';

describe('the deck', () => {
	it('has 52 different cards', () => {
		expect(new Set(DECK).size).toBe(52);
		expect(cardName('10♣')).toBe('Ten of Clubs');
		expect(cardName('A♠')).toBe('Ace of Spades');
	});

	it('reads the cards line however it was typed', () => {
		expect(drawn('tension 2\ncards: 7h, q♠ 10D 1c x 7♥')).toEqual(['7♥', 'Q♠', '10♦', 'A♣']);
		expect(drawn('tension 2')).toEqual([]);
	});

	it('never draws a card twice before a shuffle', () => {
		let body = 'tension 2\nthread: Home';
		const seen = new Set<string>();
		for (let i = 0; i < 52; i++) {
			const d = draw(body, () => 0.5);
			expect(seen.has(d.card)).toBe(false);
			expect(d.left).toBe(51 - i);
			seen.add(d.card);
			body = withCard(body, d);
		}
		expect(body.startsWith('tension 2\nthread: Home\ncards: ')).toBe(true);
		const again = draw(body, () => 0);
		expect(again).toEqual({ card: 'A♠', left: 51, shuffled: true });
		expect(withCard(body, again)).toBe('tension 2\nthread: Home\ncards: A♠');
		expect(journalCard(again)).toBe('- **Card:** A♠ (Ace of Spades), after a shuffle, 51 left');
	});

	it('shuffles by taking the cards line away, leaving the rest', () => {
		expect(shuffle('tension 2\ncards: 7♥ Q♠\nnpc: Marra')).toBe('tension 2\nnpc: Marra');
	});

	it('keeps card lines out of the story, or shortens them', () => {
		const note = 'I sit down.\n\n- **Card:** 7♥ (Seven of Hearts), 51 left\n\n*The deck is shuffled.*\n\nI stand up.';
		expect(story(note, 'out')).toBe('I sit down.\n\nI stand up.\n');
		expect(story(note, 'short')).toContain('*Card: 7♥ (Seven of Hearts), 51 left.*');
	});
});
