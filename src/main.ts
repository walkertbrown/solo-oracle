import { Editor, MarkdownPostProcessorContext, MarkdownRenderChild, Plugin, TFile } from 'obsidian';
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

const TEMPLATE = '```solo\ntension 2\nthread: \nnpc: \n```\n';
const OPEN = /^((?:\s*>)*\s*)(`{3,}|~{3,})\s*solo\b/;

// What the panel last said, by note, so it is still there after the note is rewritten and the block drawn again.
interface Said {
	big: string;
	small?: string;
	tone?: 'yes' | 'no';
}

export default class SoloOraclePlugin extends Plugin {
	rng: Rng = Math.random;
	said = new Map<string, Said>();

	async onload() {
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
			const lines = data.split('\n');
			const open = OPEN.exec(lines[info.lineStart] ?? '');
			const close = lines[info.lineEnd] ?? '';
			if (!open || !close.includes(open[2]!)) return data; // the note changed under us; leave it alone
			if (edit) {
				const prefix = open[1]!;
				const body = lines
					.slice(info.lineStart + 1, info.lineEnd)
					.map((l) => l.slice(prefix.length))
					.join('\n');
				const next = edit(body)
					.split('\n')
					.filter((l, i, a) => l.trim() || i < a.length - 1)
					.map((l) => prefix + l);
				lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...next);
			}
			ok = true;
			let out = lines.join('\n');
			if (journal) out = append(out, journal);
			return out;
		});
		return ok;
	}
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

	constructor(private plugin: SoloOraclePlugin, el: HTMLElement, private ctx: MarkdownPostProcessorContext, src: string) {
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
			const x = li.createEl('button', { text: '×', cls: 'solo-oracle-remove' });
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
