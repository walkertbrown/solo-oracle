// Browser demo: runs the real Solo Oracle plugin against the test shim, over a sample note, and shows the note's
// text growing as the oracle is asked.
import { App, installDomHelpers } from '../test/obsidian-shim';
import SoloOraclePlugin from '../src/main';

installDomHelpers();

const START = `# The drowned bell

A fishing town where the church bell rings from under the water. I came for my brother.

\`\`\`solo
tension 2
thread: Find my brother
thread: Who rings the bell?
npc: Old Marra, the ferrywoman
npc: Father Aldous
\`\`\`

I step off the ferry at dusk.`;

type Ctx = { sourcePath: string; addChild: () => void; getSectionInfo: () => { text: string; lineStart: number; lineEnd: number } };
type Proc = (src: string, el: HTMLElement, c: Ctx) => void;

async function main() {
	const app = new App();
	app.notes.set('Run.md', { path: 'Run.md', content: START });
	const plugin = new SoloOraclePlugin(app as never, { id: 'solo-oracle' } as never);
	await plugin.onload();
	const proc = (plugin as never as { codeBlocks: Record<string, Proc> }).codeBlocks.solo!;

	const note = () => app.notes.get('Run.md')!.content;
	const ctx: Ctx = {
		sourcePath: 'Run.md',
		addChild: () => {},
		getSectionInfo: () => {
			const lines = note().split('\n');
			const lineStart = lines.findIndex((l) => l.startsWith('```solo'));
			const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
			return { text: note(), lineStart, lineEnd };
		},
	};
	const body = () => {
		const info = ctx.getSectionInfo();
		return note().split('\n').slice(info.lineStart + 1, info.lineEnd).join('\n');
	};

	const source = document.querySelector<HTMLElement>('#source');
	const board = document.querySelector<HTMLElement>('#board');
	const journal = document.querySelector<HTMLElement>('#journal');

	// the note after the block, drawn roughly as Obsidian would
	const inline = (s: string) =>
		s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
			.replace(/\*(.+?)\*/g, '<i>$1</i>');
	const drawJournal = () => {
		if (!journal) return;
		const after = note().split('\n').slice(ctx.getSectionInfo().lineEnd + 1);
		let html = '';
		let open = 0;
		for (const l of after) {
			const m = /^(\t*)- (.*)$/.exec(l);
			const depth = m ? m[1]!.length + 1 : 0;
			while (open > depth) (html += '</ul>'), open--;
			while (open < depth) (html += '<ul>'), open++;
			if (m) html += `<li>${inline(m[2]!)}</li>`;
			else if (l.startsWith('### ')) html += `<h3>${inline(l.slice(4))}</h3>`;
			else if (l.trim()) html += `<p>${inline(l)}</p>`;
		}
		while (open-- > 0) html += '</ul>';
		journal.innerHTML = html;
		journal.scrollTop = journal.scrollHeight;
	};

	const draw = () => {
		if (board) {
			const typing = board.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT' ? (document.activeElement as HTMLElement).className : '';
			proc(body(), board, ctx);
			if (typing) board.querySelector<HTMLInputElement>(`.${typing.split(' ')[0]}`)?.focus();
		}
		if (source) {
			source.textContent = note();
			source.scrollTop = source.scrollHeight;
		}
		drawJournal();
	};
	const flash = () => {
		if (!source) return;
		source.classList.remove('flash');
		void source.offsetWidth;
		source.classList.add('flash');
	};

	const process = app.vault.process;
	app.vault.process = async (f, fn) => {
		const out = await process(f, fn);
		draw();
		flash();
		return out;
	};
	draw();

	document.querySelector('#reset')?.addEventListener('click', () => {
		app.notes.get('Run.md')!.content = START;
		plugin.said.clear();
		draw();
	});
}

void main();
