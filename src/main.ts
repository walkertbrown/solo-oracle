import { App, Editor, ItemView, MarkdownPostProcessorContext, MarkdownRenderChild, Modal, Notice, Plugin, PluginSettingTab, SettingDefinitionItem, TAbstractFile, TFile, WorkspaceLeaf, requestUrl } from 'obsidian';
import { freePath, importTable } from './import';
import { story, type Rolls } from './story';
import { STARTER, STARTER_NOTE, withStarter } from './starter';
import { linkText, linkTo, search, tablesIn, type Found } from './library';
import {
	ODDS,
	TENSION_MAX,
	TENSION_MIN,
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
	twistText,
	words,
	type ListKind,
	type Rng,
	type Solo,
} from './oracle';
import { draw, drawn, cardName, journalCard, shuffle, withCard } from './cards';
import { expand, hasInnerTable, journalTable, parseTableLink, rollOn, section, type TableLink, type TableRoll } from './tables';

const TEMPLATE = '```solo\ntension 2\nthread: \nnpc: \n```\n';
const OPEN = /^((?:\s*>)*\s*)(`{3,}|~{3,})\s*solo\b/;
const VIEW = 'solo-oracle-library';
const DEPTH = 5; // tables rolled inside tables, at most; a table that names itself stops here

// What the panel last said, by note, so it is still there after the note is rewritten and the block drawn again.
interface Said {
	big: string;
	small?: string;
	tone?: 'yes' | 'no';
}

export const SERVER = 'https://bulkhead.bananafest-destiny.com';
export const BUY = 'https://bananafestdestiny.itch.io/solo-oracle-pro'; // where Pro is sold; the key check asks the server, not this

interface Settings {
	folder: string; // where the library looks for tables; "" is the whole vault
	key: string; // the Pro key from itch (or the download page's address); kept in the vault's plugin folder
	pro: boolean; // the server said the key is good; asked again only when Check is pressed
}

export default class SoloOraclePlugin extends Plugin {
	rng: Rng = Math.random;
	pro = false;
	said = new Map<string, Said>();
	settings: Settings = { folder: 'Tables', key: '', pro: false };

	async onload() {
		this.settings = { ...this.settings, ...((await this.loadData()) as Partial<Settings> | null) };
		this.pro = this.settings.pro;
		this.addSettingTab(new SoloOracleSettingTab(this.app, this));
		this.registerView(VIEW, (leaf) => new Library(leaf, this));
		this.addCommand({ id: 'open-library', name: 'Open table library', callback: () => void this.openLibrary() });
		this.addCommand({ id: 'import-table', name: 'Import a table', callback: () => this.importTable() });
		this.addCommand({ id: 'export-story', name: 'Export this game as a story', callback: () => void this.exportStory() });
		this.addCommand({ id: 'add-starter-tables', name: 'Add starter tables', callback: () => void this.addStarter() });
		this.registerMarkdownCodeBlockProcessor('solo', (src, el, ctx) => {
			const panel = new Panel(this, el, ctx, src);
			ctx.addChild(panel);
			panel.draw();
		});
		this.addCommand({
			id: 'insert-block',
			name: 'Insert solo block',
			editorCallback: (editor: Editor) => editor.replaceSelection(TEMPLATE),
		});
	}

	/** Rewrites the block's body and adds `journal` to the end of the note, in one write. False when the block can't be
	 *  found. */
	async write(el: HTMLElement, ctx: MarkdownPostProcessorContext, edit: ((body: string) => string) | null, journal?: string): Promise<boolean> {
		const info = ctx.getSectionInfo(el);
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!info || !(file instanceof TFile)) return false;
		let ok = false;
		await this.app.vault.process(file, (data) => {
			const out = editBlock(data, info.lineStart, info.lineEnd, edit);
			if (out === null) return data; // the note changed under us; leave it alone
			ok = true;
			return journal ? append(out, journal) : out;
		});
		return ok;
	}

	/** One roll on the table a `table:` line links to, or why it can't be rolled. */
	async rollTable(link: TableLink, sourcePath: string, depth = 1): Promise<TableRoll | { error: string }> {
		const file = this.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath);
		if (!(file instanceof TFile)) return { error: `No note "${link.path}"` };
		const text = section(await this.app.vault.cachedRead(file), link.heading);
		if (text === null) return { error: `No heading "${link.heading}" in "${link.path}"` };
		const r = rollOn(text, () => this.rng());
		if (!r) return { error: `Nothing to roll on in "${link.label}"` };
		const deeper =
			this.pro && depth < DEPTH
				? async (l: TableLink) => {
						const n = await this.rollTable(l, sourcePath, depth + 1);
						return 'error' in n ? null : n.text;
					}
				: null;
		return { ...r, text: await expand(r.text, () => this.rng(), deeper) };
	}

	async openLibrary() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW, active: true });
		}
		if (leaf) await workspace.revealLeaf(leaf);
	}

	importTable() {
		if (!this.pro) return void new Notice('Importing tables comes with Solo Oracle Pro.');
		new ImportModal(this.app, this).open();
	}

	async exportStory() {
		if (!this.pro) return void new Notice('Exporting a game comes with Solo Oracle Pro.');
		const game = await this.game();
		if (!game) return void new Notice('Open a note with a solo block first.');
		new StoryModal(this.app, this, game).open();
	}

	/** Writes the story of `game` beside it and opens it. */
	async writeStory(game: TFile, rolls: Rolls) {
		const { vault } = this.app;
		const text = story(await vault.cachedRead(game), rolls);
		const at = game.path.lastIndexOf('/');
		const path = freePath(at < 0 ? '' : game.path.slice(0, at), `${game.basename} (story)`, (p) => !!vault.getAbstractFileByPath(p));
		await this.app.workspace.getLeaf(true).openFile(await vault.create(path, text));
	}

	/** Writes an imported table as a note of its own in the library folder. The note's path. */
	async addTable(name: string, md: string): Promise<string> {
		const { vault } = this.app;
		const folder = this.settings.folder.replace(/^\/+|\/+$/g, '');
		if (folder && !vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
		const path = freePath(folder, name, (p) => !!vault.getAbstractFileByPath(p));
		await vault.create(path, md + '\n');
		return path;
	}

	/** Writes the starter tables into the library folder, unless they are there already. Their note's path. */
	async starter(): Promise<string> {
		const { vault } = this.app;
		const folder = this.settings.folder.replace(/^\/+|\/+$/g, '');
		const path = `${folder ? `${folder}/` : ''}${STARTER}.md`;
		if (vault.getAbstractFileByPath(path)) return path;
		if (folder && !vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
		await vault.create(path, STARTER_NOTE);
		return path;
	}

	/** The command: the starter tables, on the open game's panel if there is one, or opened to read if not. */
	async addStarter() {
		const path = await this.starter();
		const game = await this.game();
		if (game && (await this.writeGame(game, (body) => withStarter(body, path)))) {
			return void new Notice(`Starter tables are in ${path}. Place, Complication and Stranger are on this game's panel.`);
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
		new Notice(`Starter tables are in ${path}. Add one to a game with a table line, like table: [[${STARTER}#Place]].`);
	}

	inLibrary(path: string): boolean {
		const f = this.settings.folder.replace(/^\/+|\/+$/g, '');
		return path.endsWith('.md') && (!f || path.startsWith(f + '/'));
	}

	/** Every table in the library folder, note by note in path order. */
	async library(): Promise<Found[]> {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => this.inLibrary(f.path))
			.sort((a, b) => a.path.localeCompare(b.path));
		const all: Found[] = [];
		for (const f of files) all.push(...tablesIn(f.path, await this.app.vault.cachedRead(f)));
		return all;
	}

	/** The open note, if it holds a solo block: where the library writes. */
	async game(): Promise<TFile | null> {
		const f = this.app.workspace.getActiveFile();
		return f && f.extension === 'md' && firstBlock(await this.app.vault.cachedRead(f)) ? f : null;
	}

	/** Changes the first solo block in `file` and adds `journal` to the end. False when there's no block. */
	async writeGame(file: TFile, edit: ((body: string) => string) | null, journal?: string): Promise<boolean> {
		let ok = false;
		await this.app.vault.process(file, (data) => {
			const b = firstBlock(data);
			const out = b && editBlock(data, b.start, b.end, edit);
			if (!out) return data;
			ok = true;
			return journal ? append(out, journal) : out;
		});
		return ok;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Asks the server whether the key in settings is good, turns Pro on or off by the answer, and says it in words.
	 *  The only time the plugin goes online, with the Mail button below. */
	async checkKey(): Promise<string> {
		const r = await requestUrl({ url: `${SERVER}/api/oracle/key`, method: 'POST', contentType: 'application/json', body: JSON.stringify({ key: this.settings.key }), throw: false }).catch(() => null);
		if (r?.status !== 200) return 'Could not check the key. Check the connection and try again.';
		const got = r.json as { ok?: boolean; sold?: boolean; buy?: string };
		if (got.sold === false) return 'Solo Oracle Pro isn\'t sold yet.';
		await this.setPro(!!got.ok);
		if (got.ok) return 'Good key. Pro is on in this vault: tables inside tables, the table library, importing and exporting.';
		return `itch doesn't know that key for Solo Oracle Pro. Paste the address of your download page, or the key at the end of it.${got.buy ? ` Keys are at ${got.buy}` : ''}`;
	}

	/** Mails the key again to the address that bought Pro. The server says the same whether or not it did. */
	async mailKey(email: string): Promise<string> {
		const r = await requestUrl({ url: `${SERVER}/api/oracle/key/mail`, method: 'POST', contentType: 'application/json', body: JSON.stringify({ email }), throw: false }).catch(() => null);
		return r?.status === 200 ? 'If that address bought Solo Oracle Pro, its key is on the way. Look in your mail in a minute.' : 'Could not ask for the key. Check the connection and try again.';
	}

	async setPro(on: boolean) {
		if (this.pro === on) return;
		this.pro = this.settings.pro = on;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof Library) void leaf.view.onOpen();
	}
}

class SoloOracleSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SoloOraclePlugin) {
		super(app, plugin);
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		const p = this.plugin;
		return [
			{
				name: 'Pro key',
				desc: 'The address of your itch download page for Solo Oracle Pro, or the key at the end of it. Check asks this plugin\'s server once, and Pro stays on after that, offline too. It is kept in this vault\'s plugin folder.',
				render: (setting) => {
					if (!p.pro) setting.descEl.createDiv().createEl('a', { text: 'Get Solo Oracle Pro on itch', href: BUY });
					const said = setting.descEl.createDiv({ cls: 'solo-oracle-said' });
					setting
						.addText((t) => t.setPlaceholder('Download page address or key').setValue(p.settings.key).onChange(async (v) => {
							p.settings.key = v.trim();
							await p.saveSettings();
						}))
						.addButton((b) => b.setButtonText('Check').onClick(async () => said.setText(await p.checkKey())));
				},
			},
			{
				name: 'Lost your key?',
				desc: 'Type the email you bought Solo Oracle Pro with, and its key is mailed there.',
				render: (setting) => {
					let email = '';
					const said = setting.descEl.createDiv({ cls: 'solo-oracle-said' });
					setting
						.addText((t) => t.setPlaceholder('you@example.com').onChange((v) => (email = v.trim())))
						.addButton((b) => b.setButtonText('Mail my key').onClick(async () => said.setText(await p.mailKey(email))));
				},
			},
		];
	}
}

/** The block between `start` and `end` with its body run through `edit`, or null when those lines aren't a solo block
 *  any more. Lines keep a callout's `> ` in front. */
export function editBlock(data: string, start: number, end: number, edit: ((body: string) => string) | null): string | null {
	const lines = data.split('\n');
	const open = OPEN.exec(lines[start] ?? '');
	if (!open || !(lines[end] ?? '').includes(open[2]!)) return null;
	if (edit) {
		const prefix = open[1]!;
		const body = lines
			.slice(start + 1, end)
			.map((l) => l.slice(prefix.length))
			.join('\n');
		const next = edit(body)
			.split('\n')
			.filter((l, i, a) => l.trim() || i < a.length - 1)
			.map((l) => prefix + l);
		lines.splice(start + 1, end - start - 1, ...next);
	}
	return lines.join('\n');
}

export function firstBlock(data: string): { start: number; end: number } | null {
	const lines = data.split('\n');
	const start = lines.findIndex((l) => OPEN.test(l));
	if (start < 0) return null;
	const fence = OPEN.exec(lines[start]!)![2]!;
	const end = lines.findIndex((l, i) => i > start && l.includes(fence));
	return end < 0 ? null : { start, end };
}

// A list line follows a list line directly; anything else gets a blank line before it.
export function append(note: string, text: string): string {
	const trimmed = note.replace(/\s+$/, '');
	if (!trimmed) return text + '\n';
	const last = trimmed.split('\n').pop()!;
	const list = (l: string) => /^\s*- /.test(l);
	return `${trimmed}${list(last) && list(text) ? '\n' : '\n\n'}${text}\n`;
}

class Panel extends MarkdownRenderChild {
	solo: Solo;

	constructor(private plugin: SoloOraclePlugin, el: HTMLElement, private ctx: MarkdownPostProcessorContext, private src: string) {
		super(el);
		this.solo = parseSolo(src);
	}

	private say(s: Said) {
		this.plugin.said.set(this.ctx.sourcePath, s);
	}

	private async write(edit: ((body: string) => string) | null, journal?: string) {
		const ok = await this.plugin.write(this.containerEl, this.ctx, edit, journal);
		// with no change to the block, Obsidian won't draw it again; do it here so the answer shows
		if (ok && !edit) this.draw();
	}

	draw() {
		const el = this.containerEl;
		el.empty();
		el.addClass('solo-oracle');
		const { solo } = this;
		const rng: Rng = () => this.plugin.rng(); // read when used, so a test can set it after drawing

		const head = el.createDiv({ cls: 'solo-oracle-head' });
		head.createSpan({ cls: 'solo-oracle-scene', text: solo.scene ? `Scene ${solo.scene.n}${solo.scene.title ? `: ${solo.scene.title}` : ''}` : 'No scene yet' });
		const t = head.createDiv({ cls: 'solo-oracle-tension' });
		t.createSpan({ cls: 'solo-oracle-label', text: 'Tension' });
		const down = t.createEl('button', { text: '−', cls: 'solo-oracle-step' });
		down.setAttr('aria-label', 'Less tension');
		down.disabled = solo.tension <= TENSION_MIN;
		down.onclick = () => void this.write((b) => setTension(b, solo.tension - 1));
		const pips = t.createSpan({ cls: 'solo-oracle-pips' });
		pips.setAttr('aria-label', `Tension ${solo.tension} of ${TENSION_MAX}`);
		for (let i = 1; i <= TENSION_MAX; i++) pips.createSpan({ cls: i <= solo.tension ? 'solo-oracle-pip is-on' : 'solo-oracle-pip' });
		const up = t.createEl('button', { text: '+', cls: 'solo-oracle-step' });
		up.setAttr('aria-label', 'More tension');
		up.disabled = solo.tension >= TENSION_MAX;
		up.onclick = () => void this.write((b) => setTension(b, solo.tension + 1));

		// the question and the odds to ask it at
		const q = el.createEl('input', { type: 'text', cls: 'solo-oracle-question', placeholder: 'Ask a yes or no question' });
		q.setAttr('aria-label', 'Question');
		const odds = el.createDiv({ cls: 'solo-oracle-odds' });
		for (const o of ODDS) {
			const b = odds.createEl('button', { text: o.label, cls: o.key === 'even' ? 'mod-cta' : '' });
			b.setAttr('title', `${o.chance}% yes`);
			b.onclick = () => {
				const a = ask(q.value, o.key, solo, rng);
				this.say({ big: answerText(a), small: a.twist ? `Twist: ${twistText(a.twist)}` : undefined, tone: a.yes ? 'yes' : 'no' });
				void this.write(null, journalAnswer(a));
			};
		}
		q.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') odds.querySelector<HTMLButtonElement>('.mod-cta')?.click();
		});

		const said = this.plugin.said.get(this.ctx.sourcePath);
		const out = el.createDiv({ cls: 'solo-oracle-said' });
		out.setAttr('aria-live', 'polite');
		if (said) {
			const big = out.createDiv({ cls: 'solo-oracle-big', text: said.big });
			if (said.tone) big.addClass(`is-${said.tone}`);
			if (said.small) out.createDiv({ cls: 'solo-oracle-small', text: said.small });
		}

		const more = el.createDiv({ cls: 'solo-oracle-more' });
		more.createEl('button', { text: 'Twist' }).onclick = () => {
			const tw = twist(solo, rng);
			this.say({ big: 'Twist', small: twistText(tw) });
			void this.write(null, `- **Twist:** ${twistText(tw)}`);
		};
		more.createEl('button', { text: 'Two words' }).onclick = () => {
			const w = words(rng).join(' · ');
			this.say({ big: w });
			void this.write(null, `- **Words:** ${w}`);
		};
		// a deck of playing cards; the block keeps what's been drawn
		const gone = drawn(this.src).length;
		const card = more.createEl('button', { text: 'Draw a card' });
		card.setAttr('title', `${52 - gone} left in the deck`);
		card.onclick = () => {
			const d = draw(this.src, rng);
			this.say({ big: d.card, small: `${cardName(d.card)}, ${d.left} left${d.shuffled ? ' after a shuffle' : ''}` });
			void this.write((b) => withCard(b, d), journalCard(d));
		};
		if (gone) {
			more.createEl('button', { text: 'Shuffle' }).onclick = () => {
				this.say({ big: 'Shuffled', small: 'All 52 cards are back in the deck.' });
				void this.write(shuffle, '*The deck is shuffled.*');
			};
		}

		// scenes: what you expect, then the tension may change it; the end moves the tension
		const scene = el.createDiv({ cls: 'solo-oracle-row' });
		const next = scene.createEl('input', { type: 'text', cls: 'solo-oracle-next', placeholder: 'The next scene, as you expect it' });
		next.setAttr('aria-label', 'Next scene');
		const begin = () => {
			const s = startScene(next.value, solo, rng);
			this.say({ big: `Scene ${s.n}`, small: s.result === 'expected' ? 'As expected.' : s.result === 'changed' ? `Not quite: ${s.change!.join(' · ')}` : `Interrupted. ${twistText(s.twist!)}` });
			void this.write((b) => setScene(b, s.n, s.title), journalScene(s));
		};
		scene.createEl('button', { text: 'New scene' }).onclick = begin;
		next.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') begin();
		});
		if (solo.scene) {
			const end = el.createDiv({ cls: 'solo-oracle-row solo-oracle-end' });
			end.createSpan({ cls: 'solo-oracle-label', text: `Scene ${solo.scene.n} ends:` });
			const close = (better: boolean) => {
				const n = Math.max(TENSION_MIN, Math.min(TENSION_MAX, solo.tension + (better ? -1 : 1)));
				this.say({ big: `Scene ${solo.scene!.n} ends`, small: `Tension ${n}` });
				void this.write((b) => setTension(b, n), `*Scene ${solo.scene!.n} ends ${better ? 'my way' : 'against me'}. Tension ${n}.*`);
			};
			end.createEl('button', { text: 'Went my way' }).onclick = () => close(true);
			end.createEl('button', { text: 'Went against me' }).onclick = () => close(false);
		}

		const lists = el.createDiv({ cls: 'solo-oracle-lists' });
		this.list(lists, 'thread', 'Threads', solo.threads);
		this.list(lists, 'npc', 'People', solo.npcs);
		this.tables(el, solo.tables);
	}

	private tables(parent: HTMLElement, lines: string[]) {
		const box = parent.createDiv({ cls: 'solo-oracle-tables' });
		box.createDiv({ cls: 'solo-oracle-label', text: 'Tables' });
		const row = box.createDiv({ cls: 'solo-oracle-table-row' });
		lines.forEach((line, i) => {
			const link = parseTableLink(line);
			const chip = row.createSpan({ cls: 'solo-oracle-table' });
			const b = chip.createEl('button', { text: link?.label ?? line });
			b.setAttr('title', `Roll on ${line}`);
			b.disabled = !link;
			b.onclick = async () => {
				if (!link) return;
				const r = await this.plugin.rollTable(link, this.ctx.sourcePath);
				if ('error' in r) {
					this.say({ big: 'Can\'t roll', small: r.error });
					this.draw();
					return;
				}
				const said = r.roll !== undefined ? `${link.label}, rolled ${r.roll}` : link.label;
				this.say({ big: r.text, small: !this.plugin.pro && hasInnerTable(r.text) ? `${said}. Tables inside tables roll with Pro.` : said });
				void this.write(null, journalTable(link, r));
			};
			const x = chip.createEl('button', { text: '×', cls: 'solo-oracle-remove clickable-icon' });
			x.setAttr('aria-label', `Remove ${line}`);
			x.onclick = () => void this.write((body) => removeEntry(body, 'table', i));
		});
		if (!lines.length) {
			const b = row.createEl('button', { text: 'Add starter tables', cls: 'solo-oracle-starter' });
			b.setAttr('title', 'Write a note of starter tables and put three of them here');
			b.onclick = async () => {
				const path = await this.plugin.starter();
				void this.write((body) => withStarter(body, path));
			};
		}
		const add = box.createEl('input', { type: 'text', cls: 'solo-oracle-add-table', placeholder: 'Add a table: a note, or Note#Heading' });
		add.setAttr('aria-label', 'Add a table');
		add.addEventListener('keydown', (e) => {
			const link = parseTableLink(add.value);
			if (e.key !== 'Enter' || !link) return;
			const text = /^\s*\[\[/.test(add.value) ? add.value.trim() : `[[${add.value.trim()}]]`;
			add.value = '';
			void this.write((body) => addEntry(body, 'table', text));
		});
		if (!this.plugin.pro) {
			const hint = box.createDiv({ cls: 'solo-oracle-pro-hint' });
			hint.appendText('All your tables in one library, imported from text or CSV, rolling tables inside tables: ');
			hint.createEl('a', { text: 'Solo Oracle Pro', href: BUY });
		}
	}

	private list(parent: HTMLElement, kind: ListKind, title: string, items: string[]) {
		const box = parent.createDiv({ cls: 'solo-oracle-list' });
		const head = box.createDiv({ cls: 'solo-oracle-list-head' });
		head.createSpan({ cls: 'solo-oracle-label', text: title });
		const roll = head.createEl('button', { text: 'Pick one', cls: 'solo-oracle-pick' });
		roll.disabled = !items.length;
		roll.onclick = () => {
			const it = items[Math.floor(this.plugin.rng() * items.length)]!;
			this.say({ big: it, small: kind === 'thread' ? 'Thread' : 'Person' });
			void this.write(null, `- **${kind === 'thread' ? 'Thread' : 'Person'}:** ${it}`);
		};
		const ul = box.createEl('ul');
		items.forEach((it, i) => {
			const li = ul.createEl('li');
			li.createSpan({ text: it });
			const x = li.createEl('button', { text: '×', cls: 'solo-oracle-remove clickable-icon' });
			x.setAttr('aria-label', `Remove ${it}`);
			x.onclick = () => void this.write((b) => removeEntry(b, kind, i));
		});
		const add = box.createEl('input', { type: 'text', cls: 'solo-oracle-add', placeholder: kind === 'thread' ? 'Add a thread' : 'Add a person' });
		add.setAttr('aria-label', kind === 'thread' ? 'Add a thread' : 'Add a person');
		add.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter' || !add.value.trim()) return;
			const text = add.value;
			add.value = '';
			void this.write((b) => addEntry(b, kind, text));
		});
	}
}

// The table library: a side view of every table in the library folder. Search narrows it; a click rolls and writes
// the result into the open game, and + adds the table to that game's block.
class Library extends ItemView {
	all: Found[] = [];
	said: Said | null = null;
	private list!: HTMLElement;
	private out!: HTMLElement;
	private query!: HTMLInputElement;
	private timer = 0;

	constructor(leaf: WorkspaceLeaf, private plugin: SoloOraclePlugin) {
		super(leaf);
	}

	getViewType() {
		return VIEW;
	}
	getDisplayText() {
		return 'Table library';
	}
	getIcon() {
		return 'dices';
	}

	async onOpen() {
		const el = this.contentEl;
		el.empty();
		el.addClass('solo-oracle', 'solo-oracle-library');
		if (!this.plugin.pro) {
			el.createDiv({ cls: 'solo-oracle-label', text: 'Table library' });
			el.createEl('p', { text: 'The table library comes with Solo Oracle Pro: every table in a folder, to search and roll without adding it to a game first. A Pro key goes in Solo Oracle\'s settings.' });
			el.createEl('a', { text: 'Get Solo Oracle Pro on itch', href: BUY });
			return;
		}
		const where = el.createDiv({ cls: 'solo-oracle-row' });
		where.createSpan({ cls: 'solo-oracle-label', text: 'Folder' });
		const folder = where.createEl('input', { type: 'text', cls: 'solo-oracle-folder', placeholder: 'Empty for the whole vault' });
		folder.value = this.plugin.settings.folder;
		folder.setAttr('aria-label', 'Library folder');
		folder.addEventListener('change', () => {
			this.plugin.settings.folder = folder.value.trim();
			void this.plugin.saveSettings();
			void this.refresh();
		});
		const find = el.createDiv({ cls: 'solo-oracle-row' });
		this.query = find.createEl('input', { type: 'text', cls: 'solo-oracle-search', placeholder: 'Search tables' });
		this.query.setAttr('aria-label', 'Search tables');
		find.createEl('button', { text: 'Import' }).onclick = () => this.plugin.importTable();
		this.query.addEventListener('input', () => this.draw());
		this.out = el.createDiv({ cls: 'solo-oracle-said' });
		this.out.setAttr('aria-live', 'polite');
		this.list = el.createDiv({ cls: 'solo-oracle-library-list' });
		const later = (f: TAbstractFile, old?: string) => {
			if (!this.plugin.inLibrary(f.path) && !(old && this.plugin.inLibrary(old))) return;
			window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => void this.refresh(), 300);
		};
		this.register(() => window.clearTimeout(this.timer));
		for (const e of ['create', 'modify', 'delete'] as const) this.registerEvent(this.app.vault.on(e as 'modify', later));
		this.registerEvent(this.app.vault.on('rename', later));
		await this.refresh();
	}

	async refresh() {
		this.all = await this.plugin.library();
		this.draw();
	}

	private say(s: Said) {
		this.said = s;
		this.draw();
	}

	draw() {
		const { out, list } = this;
		out.empty();
		if (this.said) {
			out.createDiv({ cls: 'solo-oracle-big', text: this.said.big });
			if (this.said.small) out.createDiv({ cls: 'solo-oracle-small', text: this.said.small });
		}
		list.empty();
		const found = search(this.all, this.query.value);
		if (!this.all.length) {
			const f = this.plugin.settings.folder;
			list.createEl('p', { cls: 'solo-oracle-small', text: f ? `No tables in "${f}" yet. A heading with a table or a list under it is a table.` : 'No tables in the vault yet. A heading with a table or a list under it is a table.' });
			return;
		}
		list.createDiv({ cls: 'solo-oracle-small', text: found.length === this.all.length ? `${found.length} tables` : `${found.length} of ${this.all.length} tables` });
		let folder: string | null = null;
		let note: HTMLElement | null = null;
		let file = '';
		for (const f of found) {
			if (f.folder !== folder) {
				folder = f.folder;
				list.createDiv({ cls: 'solo-oracle-label solo-oracle-library-folder', text: f.folder || '/' });
			}
			if (f.file !== file || !note) {
				file = f.file;
				const box = list.createDiv({ cls: 'solo-oracle-library-note' });
				box.createDiv({ cls: 'solo-oracle-library-name', text: f.note });
				note = box.createDiv({ cls: 'solo-oracle-table-row' });
			}
			const chip = note.createSpan({ cls: 'solo-oracle-table' });
			const b = chip.createEl('button', { text: f.heading ?? f.note });
			b.createSpan({ cls: 'solo-oracle-kind', text: f.kind });
			b.setAttr('title', `Roll on ${linkText(f)}`);
			b.onclick = () => void this.roll(f);
			const add = chip.createEl('button', { text: '+', cls: 'solo-oracle-add-game clickable-icon' });
			add.setAttr('aria-label', `Add ${f.heading ?? f.note} to the game's tables`);
			add.onclick = () => void this.addToGame(f);
		}
	}

	private async roll(f: Found) {
		const link = linkTo(f);
		const r = await this.plugin.rollTable(link, f.file);
		if ('error' in r) return this.say({ big: 'Can\'t roll', small: r.error });
		const said = r.roll !== undefined ? `${link.label}, rolled ${r.roll}` : link.label;
		const game = await this.plugin.game();
		if (game) await this.plugin.writeGame(game, null, journalTable(link, r));
		this.say({ big: r.text, small: game ? `${said}. Written in ${game.basename}.` : `${said}. Open a note with a solo block to write rolls into it.` });
	}

	private async addToGame(f: Found) {
		const game = await this.plugin.game();
		if (!game) return this.say({ big: 'No game open', small: 'Open a note with a solo block, then add the table to it.' });
		const line = linkText(f);
		await this.plugin.writeGame(game, (body) => (parseSolo(body).tables.includes(line) ? body : addEntry(body, 'table', line)));
		this.say({ big: f.heading ?? f.note, small: `In ${game.basename}'s tables.` });
	}
}

// Paste a table from a PDF or a spreadsheet, or pick a .csv or .txt file, and it becomes a note in the library folder.
class ImportModal extends Modal {
	constructor(app: App, private plugin: SoloOraclePlugin) {
		super(app);
	}

	onOpen() {
		this.setTitle('Import a table');
		const el = this.contentEl;
		el.addClass('solo-oracle', 'solo-oracle-import');
		const name = el.createEl('input', { type: 'text', cls: 'solo-oracle-import-name', placeholder: 'Name, like Loot or Harbour weather' });
		name.setAttr('aria-label', 'Table name');
		const text = el.createEl('textarea', { cls: 'solo-oracle-import-text', placeholder: '1-2 Still and grey\n3-4 Fog off the water\n5-6 A storm coming in' });
		text.setAttr('aria-label', 'Table text');
		const file = el.createEl('input', { type: 'file' });
		file.setAttr('accept', '.csv,.tsv,.txt,.md');
		file.setAttr('aria-label', 'Or pick a file');
		const asList = el.createEl('label', { cls: 'solo-oracle-import-list' });
		const box = asList.createEl('input', { type: 'checkbox' });
		asList.appendText(' Every line is one item');
		const preview = el.createDiv({ cls: 'solo-oracle-small solo-oracle-import-preview' });
		const go = el.createEl('button', { text: 'Add to the library', cls: 'mod-cta' });
		const read = () => {
			const t = importTable(text.value, box.checked);
			preview.setText(t ? `Reads as a ${t.kind}, ${t.rows} ${t.rows === 1 ? 'row' : 'rows'}.` : 'Paste a table, or pick a file.');
			go.disabled = !t;
			return t;
		};
		text.addEventListener('input', read);
		box.addEventListener('change', read);
		file.addEventListener('change', () => {
			const f = file.files?.[0];
			if (!f) return;
			if (!name.value.trim()) name.value = f.name.replace(/\.[^.]+$/, '');
			void f.text().then((t) => {
				text.value = t;
				read();
			});
		});
		go.onclick = async () => {
			const t = read();
			if (!t) return;
			const path = await this.plugin.addTable(name.value, t.md);
			new Notice(`Added ${path.split('/').pop()!.replace(/\.md$/, '')} to the table library.`);
			this.close();
		};
		read();
	}

	onClose() {
		this.contentEl.empty();
	}
}

// Export: which way the rolls go in the story.
class StoryModal extends Modal {
	constructor(app: App, private plugin: SoloOraclePlugin, private game: TFile) {
		super(app);
	}

	onOpen() {
		this.setTitle('Export this game as a story');
		const el = this.contentEl;
		el.addClass('solo-oracle', 'solo-oracle-import');
		el.createEl('p', { text: `A copy of ${this.game.basename} goes beside it, without the solo block. Your note stays as it is.` });
		const go = (rolls: Rolls) => async () => {
			await this.plugin.writeStory(this.game, rolls);
			this.close();
		};
		const row = el.createDiv({ cls: 'solo-oracle-row solo-oracle-end' });
		row.createEl('button', { text: 'Keep the rolls, one short line each', cls: 'mod-cta' }).onclick = go('short');
		row.createEl('button', { text: 'Leave the rolls out' }).onclick = go('out');
	}

	onClose() {
		this.contentEl.empty();
	}
}
