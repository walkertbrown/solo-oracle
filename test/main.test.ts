// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { App, Modal, Notice, ctx, installDomHelpers, requestUrl } from './obsidian-shim';
import SoloOraclePlugin, { SERVER, append } from '../src/main';

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

describe('tables', () => {
	const WITH = NOTE.replace('npc: Old Marra\n', 'npc: Old Marra\ntable: [[Weather#Coast]]\ntable: [[Nowhere]]\n');
	const WEATHER = '# Weather\n\n## Coast\n\n| d6 | Sky |\n|---|---|\n| 1-3 | Clear |\n| 4-6 | Fog rolls in |\n';

	it('rolls on a linked table and writes the result', async () => {
		const s = await setup(WITH);
		s.app.notes.set('Weather.md', { path: 'Weather.md', content: WEATHER });
		s.plugin.rng = seq((5 - 0.5) / 6);
		s.button('Coast').click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.content()).toMatch(/- \*\*Coast\*\* \*\(5\)\*: Fog rolls in\n$/);
		expect(s.el.querySelector('.solo-oracle-big')!.textContent).toBe('Fog rolls in');
	});

	it('rolls tables inside a result with Pro, and says so without it', async () => {
		const s = await setup(WITH);
		s.app.notes.set('Weather.md', { path: 'Weather.md', content: '## Coast\n\n- Fog and {{Weather#Sound}}\n\n## Sound\n\n- a bell\n' });
		s.plugin.rng = () => 0;
		s.button('Coast').click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.content()).toMatch(/- \*\*Coast\*\*: Fog and \{\{Weather#Sound\}\}\n$/);
		expect(s.el.querySelector('.solo-oracle-small')!.textContent).toBe('Coast. Tables inside tables roll with Pro.');
		s.plugin.pro = true;
		s.button('Coast').click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.content()).toMatch(/- \*\*Coast\*\*: Fog and a bell\n$/);
	});

	it('stops a table that rolls on itself', async () => {
		const s = await setup(WITH);
		s.app.notes.set('Weather.md', { path: 'Weather.md', content: '## Coast\n\n- again {{Weather#Coast}}\n' });
		s.plugin.pro = true;
		s.plugin.rng = () => 0;
		s.button('Coast').click();
		await new Promise((r) => setTimeout(r, 10));
		expect(s.content()).toMatch(/: again again again again again \{\{Weather#Coast\}\}\n$/);
	});

	it('says why a table cannot be rolled, without writing', async () => {
		const s = await setup(WITH);
		s.button('Nowhere').click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.el.querySelector('.solo-oracle-small')!.textContent).toBe('No note "Nowhere"');
		expect(s.content()).toBe(WITH);
	});

	it('adds a table as a link, keeping one typed with brackets as it is', async () => {
		const s = await setup(NOTE);
		await s.type('.solo-oracle-add-table', 'Weather#Inland');
		expect(s.content()).toContain('npc: Old Marra\ntable: [[Weather#Inland]]\n```');
		await s.type('.solo-oracle-add-table', '[[Names|Who]]');
		expect(s.content()).toContain('table: [[Weather#Inland]]\ntable: [[Names|Who]]\n```');
		expect(s.button('Who')).toBeDefined();
	});
});

describe('the table library', () => {
	const COAST = '## Weather\n\n| d6 | Sky |\n| --- | --- |\n| 1-3 | Clear |\n| 4-6 | Fog rolls in |\n\n## Names\n\n- Marra\n- Aldous\n';

	async function library(pro = true) {
		const s = await setup(NOTE);
		s.plugin.pro = pro;
		s.app.notes.set('Tables/Coast.md', { path: 'Tables/Coast.md', content: COAST });
		s.app.notes.set('Elsewhere.md', { path: 'Elsewhere.md', content: '- a\n- b\n' });
		await s.plugin.openLibrary();
		const view = s.app.leaves[0]!.view!;
		const lib = view.contentEl;
		const chip = (t: string) => Array.from(lib.querySelectorAll<HTMLButtonElement>('.solo-oracle-table button')).find((b) => b.firstChild?.textContent === t)!;
		return { ...s, lib, chip };
	}

	it('lists the tables in the Tables folder, by note', async () => {
		const { lib } = await library();
		expect(lib.querySelector('.solo-oracle-library-folder')!.textContent).toBe('Tables');
		expect(lib.querySelector('.solo-oracle-library-name')!.textContent).toBe('Coast');
		expect(Array.from(lib.querySelectorAll('.solo-oracle-table > button:first-child')).map((b) => b.textContent)).toEqual(['Weatherd6', 'Names2 items']);
	});

	it('narrows to what the search finds', async () => {
		const { lib } = await library();
		const q = lib.querySelector<HTMLInputElement>('.solo-oracle-search')!;
		q.value = 'aldous';
		q.dispatchEvent(new Event('input'));
		expect(lib.querySelectorAll('.solo-oracle-table')).toHaveLength(1);
		expect(lib.textContent).toContain('1 of 2 tables');
	});

	it('rolls into the open game, or only shows it when no game is open', async () => {
		const s = await library();
		s.plugin.rng = seq((5 - 0.5) / 6);
		s.chip('Weather').click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.lib.querySelector('.solo-oracle-big')!.textContent).toBe('Fog rolls in');
		expect(s.lib.querySelector('.solo-oracle-small')!.textContent).toContain('Open a note with a solo block');
		expect(s.content()).toBe(NOTE);
		s.app.active = 'Game.md';
		s.chip('Weather').click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.content()).toMatch(/- \*\*Weather\*\* \*\(5\)\*: Fog rolls in\n$/);
		expect(s.lib.querySelector('.solo-oracle-said .solo-oracle-small')!.textContent).toBe('Weather, rolled 5. Written in Game.');
	});

	it('adds a table to the open game once', async () => {
		const s = await library();
		s.app.active = 'Game.md';
		const add = s.lib.querySelector<HTMLButtonElement>('.solo-oracle-add-game')!;
		add.click();
		await new Promise((r) => setTimeout(r, 0));
		add.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.content()).toContain('npc: Old Marra\ntable: [[Tables/Coast#Weather]]\n```');
		expect(s.content().match(/table:/g)).toHaveLength(1);
	});

	it('looks in another folder, or the whole vault', async () => {
		const s = await library();
		const f = s.lib.querySelector<HTMLInputElement>('.solo-oracle-folder')!;
		f.value = '';
		f.dispatchEvent(new Event('change'));
		await new Promise((r) => setTimeout(r, 0));
		expect(s.lib.textContent).toContain('3 tables');
		expect((s.plugin as never as { data: unknown }).data).toMatchObject({ folder: '' });
	});

	it('says it comes with Pro', async () => {
		const { lib } = await library(false);
		expect(lib.textContent).toContain('comes with Solo Oracle Pro');
		expect(lib.querySelector('.solo-oracle-search')).toBeNull();
	});
});

describe('importing a table', () => {
	it('makes a note in the library folder from pasted lines', async () => {
		const s = await setup(NOTE);
		s.plugin.pro = true;
		s.plugin.importTable();
		const m = Modal.last!.contentEl;
		const go = m.querySelector<HTMLButtonElement>('.mod-cta')!;
		expect(go.disabled).toBe(true);
		m.querySelector<HTMLInputElement>('.solo-oracle-import-name')!.value = 'Loot';
		const text = m.querySelector<HTMLTextAreaElement>('textarea')!;
		text.value = '2-6 Rust\n7-11 Coins\n12 A ring';
		text.dispatchEvent(new Event('input'));
		expect(m.querySelector('.solo-oracle-import-preview')!.textContent).toBe('Reads as a 2d6 table, 3 rows.');
		go.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.app.folders.has('Tables')).toBe(true);
		expect(s.app.notes.get('Tables/Loot.md')!.content).toBe('| 2d6 | Result |\n| --- | --- |\n| 2-6 | Rust |\n| 7-11 | Coins |\n| 12 | A ring |\n');
		expect(Notice.last).toBe('Added Loot to the table library.');
	});

	it('says it comes with Pro', async () => {
		const s = await setup(NOTE);
		Modal.last = null;
		s.plugin.importTable();
		expect(Modal.last).toBeNull();
		expect(Notice.last).toBe('Importing tables comes with Solo Oracle Pro.');
	});
});

describe('exporting a game', () => {
	it('writes the story beside the game and opens it', async () => {
		const s = await setup(NOTE + '\n\n- **?** Is it raining? *(even)* → **No**\n');
		s.plugin.pro = true;
		s.app.active = 'Game.md';
		await s.plugin.exportStory();
		const m = Modal.last!.contentEl;
		Array.from(m.querySelectorAll('button')).find((b) => b.textContent === 'Leave the rolls out')!.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.app.notes.get('Game (story).md')!.content).toBe('# Run\n\nI wake on the ferry.\n');
		expect(s.app.opened).toEqual(['Game (story).md']);
		s.app.active = 'Game.md'; // the story is the open note now; go back to the game
		await s.plugin.exportStory();
		Modal.last!.contentEl.querySelector<HTMLButtonElement>('.mod-cta')!.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.app.notes.get('Game (story) 2.md')!.content).toBe('# Run\n\nI wake on the ferry.\n\n*Is it raining? No.*\n');
	});

	it('needs a game open, and Pro', async () => {
		const s = await setup(NOTE);
		await s.plugin.exportStory();
		expect(Notice.last).toBe('Exporting a game comes with Solo Oracle Pro.');
		s.plugin.pro = true;
		await s.plugin.exportStory();
		expect(Notice.last).toBe('Open a note with a solo block first.');
	});
});

describe('the Pro key', () => {
	it('turns Pro on for a good key, keeps it, and turns it off for a bad one', async () => {
		const s = await setup(NOTE);
		s.plugin.settings.key = 'AbC123_xyz-987654';
		requestUrl.reply = () => ({ status: 200, json: { ok: true, sold: true } });
		expect(await s.plugin.checkKey()).toContain('Good key');
		expect(requestUrl.sent.at(-1)).toMatchObject({ url: `${SERVER}/api/oracle/key`, method: 'POST', body: JSON.stringify({ key: 'AbC123_xyz-987654' }) });
		expect(s.plugin.pro).toBe(true);
		// a new start reads it back without going online
		const sent = requestUrl.sent.length;
		const again = new SoloOraclePlugin(s.app as never, { id: 'solo-oracle' } as never);
		(again as never as { data: unknown }).data = (s.plugin as never as { data: unknown }).data;
		await again.onload();
		expect(again.pro).toBe(true);
		expect(requestUrl.sent.length).toBe(sent);
		requestUrl.reply = () => ({ status: 200, json: { ok: false, sold: true, buy: 'https://example.itch.io/pro' } });
		expect(await s.plugin.checkKey()).toBe("itch doesn't know that key for Solo Oracle Pro. Paste the address of your download page, or the key at the end of it. Keys are at https://example.itch.io/pro");
		expect(s.plugin.pro).toBe(false);
	});

	it('leaves Pro as it is when the server can\'t be asked or nothing is sold yet', async () => {
		const s = await setup(NOTE);
		s.plugin.pro = s.plugin.settings.pro = true;
		requestUrl.reply = () => { throw new Error('offline'); };
		expect(await s.plugin.checkKey()).toContain('Could not check');
		requestUrl.reply = () => ({ status: 200, json: { ok: false, sold: false } });
		expect(await s.plugin.checkKey()).toContain("isn't sold yet");
		expect(s.plugin.pro).toBe(true);
	});

	it('opens the library when Pro comes on', async () => {
		const s = await setup(NOTE);
		await s.plugin.openLibrary();
		const lib = s.app.leaves[0]!.view!.contentEl;
		expect(lib.textContent).toContain('comes with Solo Oracle Pro');
		requestUrl.reply = () => ({ status: 200, json: { ok: true, sold: true } });
		await s.plugin.checkKey();
		await new Promise((r) => setTimeout(r, 0));
		expect(lib.querySelector('.solo-oracle-folder')).not.toBeNull();
	});

	it('asks for a lost key by email', async () => {
		const s = await setup(NOTE);
		requestUrl.reply = () => ({ status: 200, json: { ok: true } });
		expect(await s.plugin.mailKey('me@example.com')).toContain('If that address bought Solo Oracle Pro');
		expect(requestUrl.sent.at(-1)).toMatchObject({ url: `${SERVER}/api/oracle/key/mail`, body: JSON.stringify({ email: 'me@example.com' }) });
	});
});
