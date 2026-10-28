// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { App, ctx, installDomHelpers } from './obsidian-shim';
import SoloOraclePlugin, { append } from '../src/main';

beforeAll(() => installDomHelpers());

type Proc = (src: string, el: HTMLElement, c: ReturnType<typeof ctx>) => void;

// an rng that hands out these values in turn
const seq = (...v: number[]) => {
	let i = 0;
	return () => v[i++ % v.length]!;
};

async function setup(note: string) {
	const app = new App();
	app.notes.set('Game.md', { path: 'Game.md', content: note });
	const plugin = new SoloOraclePlugin(app as never, { id: 'solo-oracle' } as never);
	await plugin.onload();
	const proc = (plugin as never as { codeBlocks: Record<string, Proc> }).codeBlocks['solo']!;
	const el = document.createElement('div');
	const render = () => {
		const text = app.notes.get('Game.md')!.content;
		const lines = text.split('\n');
		const lineStart = lines.findIndex((l) => /```solo/.test(l));
		const lineEnd = lines.findIndex((l, i) => i > lineStart && l.includes('```'));
		proc(lines.slice(lineStart + 1, lineEnd).join('\n'), el, ctx('Game.md', { text, lineStart, lineEnd }));
	};
	render();
	const flush = () => new Promise((r) => setTimeout(r, 0));
	const content = () => app.notes.get('Game.md')!.content;
	const button = (text: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text)!;
	const click = async (text: string) => {
		button(text).click();
		await flush();
		render();
	};
	const type = async (sel: string, value: string) => {
		const i = el.querySelector<HTMLInputElement>(sel)!;
		i.value = value;
		i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		await flush();
		render();
	};
	return { app, plugin, el, content, click, type, button };
}

const NOTE = '# Run\n\n```solo\ntension 3\nthread: Find my brother\nnpc: Old Marra\n```\n\nI wake on the ferry.';

describe('the solo panel', () => {
	it('draws the scene, tension, odds and lists without editing the note', async () => {
		const { el, content } = await setup(NOTE);
		expect(el.querySelector('.solo-oracle-scene')!.textContent).toBe('No scene yet');
		expect(el.querySelectorAll('.solo-oracle-pip.is-on')).toHaveLength(3);
		expect(Array.from(el.querySelectorAll('.solo-oracle-odds button')).map((b) => b.textContent)).toEqual(['Sure thing', 'Likely', 'Even', 'Unlikely', 'Long shot']);
		expect(Array.from(el.querySelectorAll('.solo-oracle-list li span')).map((s) => s.textContent)).toEqual(['Find my brother', 'Old Marra']);
		expect(content()).toBe(NOTE);
	});

	it('asks the oracle and writes the answer at the end of the note', async () => {
		const s = await setup(NOTE);
		s.plugin.rng = seq(0.675, 0.95); // 68 at likely: yes, but; no twist
		s.el.querySelector<HTMLInputElement>('.solo-oracle-question')!.value = 'Is anyone on deck?';
		await s.click('Likely');
		expect(s.content()).toBe(NOTE + '\n\n- **?** Is anyone on deck? *(likely)* → **Yes, but**\n');
		expect(s.el.querySelector('.solo-oracle-big')!.textContent).toBe('Yes, but');
		s.plugin.rng = seq(0.995, 0.05, 1.5 / 12, 0, 0, 0); // 100: no, and; a twist on Old Marra
		await s.click('Even');
		expect(s.content().split('\n').slice(-3).join('\n')).toBe('- **?** The oracle *(even)* → **No, and**\n\t- **Twist:** Someone you know acts: Old Marra (abandon · an ally)\n');
	});

	it('asks at even odds on Enter', async () => {
		const s = await setup(NOTE);
		s.plugin.rng = seq(0.2, 0.95);
		await s.type('.solo-oracle-question', 'Is it raining?');
		expect(s.content()).toContain('Is it raining? *(even)*');
	});

	it('moves the tension in the block', async () => {
		const s = await setup(NOTE);
		await s.click('+');
		expect(s.content()).toContain('```solo\ntension 4\n');
		await s.click('−');
		await s.click('−');
		expect(s.content()).toContain('```solo\ntension 2\n');
	});

	it('starts a scene, then ends it and moves the tension', async () => {
		const s = await setup(NOTE);
		s.plugin.rng = seq(0.95); // 10 on the d10: as expected
		await s.type('.solo-oracle-next', 'The captain finds me');
		expect(s.content()).toContain('tension 3\nscene 1: The captain finds me\n');
		expect(s.content()).toMatch(/I wake on the ferry\.\n\n### Scene 1: The captain finds me\n\n\*As expected\.\*\n$/);
		expect(s.el.querySelector('.solo-oracle-scene')!.textContent).toBe('Scene 1: The captain finds me');
		await s.click('Went against me');
		expect(s.content()).toContain('```solo\ntension 4\n');
		expect(s.content()).toMatch(/\*Scene 1 ends against me\. Tension 4\.\*\n$/);
	});

	it('adds, picks and removes threads and people', async () => {
		const s = await setup(NOTE);
		await s.type('.solo-oracle-list:nth-child(1) .solo-oracle-add', 'Pay the guild');
		expect(s.content()).toContain('thread: Find my brother\nthread: Pay the guild\nnpc: Old Marra');
		s.plugin.rng = seq(0.9);
		s.button('Pick one').click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.content()).toMatch(/- \*\*Thread:\*\* Pay the guild\n$/);
		await s.click('×');
		expect(s.content()).not.toContain('thread: Find my brother');
	});
});

describe('appending to the note', () => {
	it('keeps list lines together and spaces anything else', () => {
		expect(append('Text', '- a')).toBe('Text\n\n- a\n');
		expect(append('- a\n', '- b')).toBe('- a\n- b\n');
		expect(append('- a\n\t- t\n\n', '- b')).toBe('- a\n\t- t\n- b\n');
		expect(append('- a', '### Scene 2')).toBe('- a\n\n### Scene 2\n');
		expect(append('', '- a')).toBe('- a\n');
	});
});
