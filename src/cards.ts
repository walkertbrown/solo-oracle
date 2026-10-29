// A deck of playing cards for games that run on one. The block keeps the cards already drawn, in order, on one line:
//
//   cards: 7♥ Q♠ 2♦               drawn so far; the rest are still in the deck
//
// A draw comes from what's left, so no card turns up twice until you shuffle. When the deck runs out it shuffles
// itself. Like oracle.ts, only text.

import type { Rng } from './oracle';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
const SUIT_NAMES = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const LETTERS: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const DECK = SUITS.flatMap((s) => RANKS.map((r) => r + s));

const CARDS = /^\s*cards\s*:(.*)$/i;

/** "7h", "7 H" or "7♥" as "7♥", and "1♠" as "A♠"; null for anything that isn't a card. */
function card(token: string): string | null {
	const m = /^(10|[2-9AJQK1])\s*([♠♥♦♣SHDC])$/i.exec(token.trim());
	if (!m) return null;
	const rank = m[1]!.toUpperCase() === '1' ? 'A' : m[1]!.toUpperCase();
	return rank + (LETTERS[m[2]!.toUpperCase()] ?? m[2]!);
}

/** The cards drawn so far, as the block lists them. */
export function drawn(body: string): string[] {
	const line = body.split('\n').find((l) => CARDS.test(l));
	if (!line) return [];
	const seen = new Set<string>();
	for (const t of CARDS.exec(line)![1]!.split(/[\s,]+/)) {
		const c = card(t);
		if (c) seen.add(c);
	}
	return [...seen];
}

export interface Draw {
	card: string;
	left: number; // cards still in the deck after this one
	shuffled: boolean; // the deck had run out and was shuffled first
}

/** Draws one card from what the block has left. */
export function draw(body: string, rng: Rng): Draw {
	const out = drawn(body);
	const shuffled = out.length >= DECK.length;
	const left = shuffled ? DECK : DECK.filter((c) => !out.includes(c));
	return { card: left[Math.floor(rng() * left.length)]!, left: left.length - 1, shuffled };
}

/** The block's body with that card drawn: added to the cards line, or alone on it after a shuffle. */
export function withCard(body: string, d: Draw): string {
	return setDrawn(body, d.shuffled ? [d.card] : [...drawn(body).filter((c) => c !== d.card), d.card]);
}

/** Puts every card back: the block loses its cards line. */
export function shuffle(body: string): string {
	return setDrawn(body, []);
}

function setDrawn(body: string, cards: string[]): string {
	const lines = body.split('\n');
	const i = lines.findIndex((l) => CARDS.test(l));
	if (!cards.length) {
		if (i >= 0) lines.splice(i, 1);
		return lines.join('\n');
	}
	const line = `cards: ${cards.join(' ')}`;
	if (i >= 0) lines[i] = line;
	else {
		while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
		lines.push(line);
	}
	return lines.join('\n');
}

/** "Seven of Hearts" */
export function cardName(c: string): string {
	const suit = SUITS.indexOf(c.slice(-1));
	return `${RANK_NAMES[RANKS.indexOf(c.slice(0, -1))]} of ${SUIT_NAMES[suit]}`;
}

export function journalCard(d: Draw): string {
	return `- **Card:** ${d.card} (${cardName(d.card)})${d.shuffled ? ', after a shuffle' : ''}, ${d.left} left`;
}
