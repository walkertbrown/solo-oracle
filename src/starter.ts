// Starter tables, so a new game has something to roll on before you write your own. Written for this plugin, like the
// oracle's words, and kept to no setting in particular. One note, a heading per table, one of each kind tables.ts reads.

import { addEntry } from './oracle';

export const STARTER = 'Starter tables';

/** The tables a game's panel gets when you add the starter tables to it. */
export const ON_PANEL = ['Place', 'Complication', 'Stranger'];

export const STARTER_NOTE = `# Starter tables

Tables for Solo Oracle to roll on. Change any line, add rows, or copy a table into a note of your own. A \`table:\` line in a solo block rolls on one, like \`table: [[Starter tables#Weather]]\`.

## Place

| d8 | Place |
|---|---|
| 1 | A crossroads with a marker nobody can read |
| 2 | A market, packing up for the night |
| 3 | A ruin that someone still lives in |
| 4 | A bridge, half down |
| 5 | A place of worship, empty |
| 6 | A camp, its fire still warm |
| 7 | Somewhere high, with a long view |
| 8 | Underground, and narrow |

## Complication

| d10 | Complication |
|---|---|
| 1 | Someone you trust is lying to you |
| 2 | The way ahead is blocked |
| 3 | You're being followed |
| 4 | Something you need breaks or runs out |
| 5 | An old debt comes due |
| 6 | The weather turns against you |
| 7 | A rival got here first |
| 8 | Someone needs help, right now |
| 9 | What you came for isn't here |
| 10 | Someone who matters has noticed you |

## Stranger

- A tired guard who wants to go home
- A child who knows a way in
- A trader with {{1d6}} things to sell and no questions to answer
- An old soldier who won't talk about it
- A scholar who is sure they're right
- A courier carrying a sealed message
- A healer who asks for nothing yet
- Someone who knows your name and shouldn't
- Two siblings who disagree about everything
- A lost traveller, {{1d6+1}} days from home

## Weather

| Weather | Weight |
|---|---|
| Clear | 3 |
| Grey and still | 3 |
| Rain | 2 |
| Wind | 2 |
| Fog | 1 |
| A storm | 1 |

## Found

| 2d6 | Found |
|---|---|
| 2 | Something priceless, and someone wants it back |
| 3-4 | A map with a piece torn away |
| 5-6 | Food and water for {{1d4}} days |
| 7 | {{2d6}} coins |
| 8-9 | A tool that mends one broken thing |
| 10-11 | A letter with your name on it |
| 12 | A key to somewhere you haven't been |

## Mood

- Tense
- Quiet
- Hopeful
- Grim
- Strange
- Festive
- Watchful
- Mournful
`;

/** The block's body with a \`table:\` line for each of ON_PANEL, from the starter note at \`path\`, that it lacks. */
export function withStarter(body: string, path: string): string {
	const note = path.replace(/\.md$/, '');
	return ON_PANEL.reduce((b, h) => (b.includes(`[[${note}#${h}`) ? b : addEntry(b, 'table', `[[${note}#${h}|${h}]]`)), body);
}
