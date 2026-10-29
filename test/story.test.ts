import { describe, expect, it } from 'vitest';
import { story } from '../src/story';

const GAME = `---
tags: solo
---
# The drowned bell

A fishing town where the bell rings from under the water.

\`\`\`solo
tension 3
scene 1: Marra rows me out
thread: Find my brother
\`\`\`

I step off the ferry at dusk.

### Scene 1: Marra rows me out

*As expected.*

- **Weather** *(3)*: Fog off the water
- **?** Does Marra know my brother *(unlikely)* → **Yes**
- **?** Is the bell ringing? *(likely)* → **Yes, but**
	- **Twist:** Someone you know is in trouble: Father Aldous (warn · a secret)
- **?** The oracle *(even)* → **No, and**

She says he went down with the bell.

- **Person:** Old Marra
- my own note, in a list

*Scene 1 ends against me. Tension 4.*
`;

describe('a game as a story', () => {
	it('drops the block and shortens the rolls', () => {
		expect(story(GAME, 'short')).toBe(`# The drowned bell

A fishing town where the bell rings from under the water.

I step off the ferry at dusk.

### Scene 1: Marra rows me out

*As expected.*

*Weather: Fog off the water.*
*Does Marra know my brother? Yes.*
*Is the bell ringing? Yes, but.*
*Twist: Someone you know is in trouble: Father Aldous (warn · a secret)*
*The oracle: No, and.*

She says he went down with the bell.

*Person: Old Marra.*
- my own note, in a list

*Scene 1 ends against me. Tension 4.*
`);
	});

	it('or leaves the rolls out, keeping the writing and the scenes', () => {
		expect(story(GAME, 'out')).toBe(`# The drowned bell

A fishing town where the bell rings from under the water.

I step off the ferry at dusk.

### Scene 1: Marra rows me out

She says he went down with the bell.

- my own note, in a list
`);
	});

	it('takes a block inside a callout out too', () => {
		expect(story('> ```solo\n> tension 2\n> ```\n\nText', 'out')).toBe('Text\n');
	});
});
