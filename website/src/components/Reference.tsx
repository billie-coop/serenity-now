import { Marked } from "marked";
import { useEffect, useRef, useState } from "react";
import readme from "../../../README.md?raw";

interface TocEntry {
	id: string;
	text: string;
	level: 2 | 3;
}

/** Same slugs GitHub generates, so README anchors work in both places. */
function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-");
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** Undo marked's escaping, for heading text used in the TOC and slugs. */
function unescapeHtml(html: string): string {
	return html
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

/** Color added and removed lines in the README's CLI output samples. */
function renderOutput(text: string): string {
	const lines = text.split("\n").map((line) => {
		const escaped = escapeHtml(line);
		if (line.startsWith("  +"))
			return `<span class="out-add">${escaped}</span>`;
		if (line.startsWith("  -") && line.endsWith("(not imported)"))
			return `<span class="out-remove">${escaped}</span>`;
		return escaped;
	});
	return `<pre><code>${lines.join("\n")}</code></pre>\n`;
}

/**
 * Everything before the README's first h2 (title, badges, gif, docs link) is
 * the overview page's job here, so the reference starts at the first section.
 */
function referenceMarkdown(): string {
	const start = readme.search(/^## /m);
	return start === -1 ? readme : readme.slice(start);
}

/**
 * Render the README once at module load with heading ids baked into the
 * HTML (post-render DOM patching would be wiped whenever React re-applies
 * innerHTML), collecting the TOC from the same pass.
 */
function buildReference(): { html: string; toc: TocEntry[] } {
	const toc: TocEntry[] = [];
	const marked = new Marked({
		renderer: {
			heading({ tokens, depth }) {
				const inline = this.parser.parseInline(tokens);
				const plain = unescapeHtml(inline.replace(/<[^>]+>/g, ""));
				const id = slugify(plain);
				if (depth === 2 || depth === 3) {
					toc.push({ id, text: plain, level: depth });
				}
				return `<h${depth} id="${id}">${inline}</h${depth}>\n`;
			},
			// README anchors (#health-checks) become the site's #reference/ hashes
			link({ href, tokens }) {
				const text = this.parser.parseInline(tokens);
				if (href.startsWith("#")) {
					return `<a href="#reference/${href.slice(1)}">${text}</a>`;
				}
				return `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
			},
			code({ text, lang }) {
				return lang === "text" ? renderOutput(text) : false;
			},
		},
	});
	return {
		html: marked.parse(referenceMarkdown(), { async: false }),
		toc,
	};
}

const { html: referenceHtml, toc: referenceToc } = buildReference();

/** Scroll a section heading under the sticky nav. */
function scrollToSection(id: string): void {
	document.getElementById(id)?.scrollIntoView({ block: "start" });
}

function currentSection(): string | undefined {
	return window.location.hash.match(/^#reference\/(.+)$/)?.[1];
}

/**
 * The reference docs are the repo README, rendered as-is: one source of
 * truth, so the site can never drift from what ships on npm. The sidebar TOC
 * deep-links to sections via `#reference/<id>` hashes, which compose with the
 * app's hash-based view routing.
 */
export function Reference() {
	const articleRef = useRef<HTMLElement>(null);
	const [activeId, setActiveId] = useState("");

	// Deep links: jump on mount, follow hash changes afterwards
	useEffect(() => {
		const section = currentSection();
		if (section) scrollToSection(section);
		else window.scrollTo({ top: 0 });
		const onHashChange = () => {
			const target = currentSection();
			if (target) scrollToSection(target);
			else window.scrollTo({ top: 0 });
		};
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);

	// Track the section currently in view to highlight it in the TOC
	useEffect(() => {
		const root = articleRef.current;
		if (!root) return;
		const observer = new IntersectionObserver(
			(observed) => {
				for (const entry of observed) {
					if (entry.isIntersecting) {
						setActiveId(entry.target.id);
						return;
					}
				}
			},
			// A band just below the sticky nav: the heading crossing it is "active"
			{ rootMargin: "-96px 0px -75% 0px" },
		);
		for (const h of root.querySelectorAll("h2, h3")) observer.observe(h);
		return () => observer.disconnect();
	}, []);

	return (
		<>
			<header className="docs-intro">
				<p className="site-eyebrow mb-4">serenity-now</p>
				<h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
					Documentation
				</h1>
				<p className="mt-4 text-lg text-slate-600">
					Get started, configure your workspace, and keep it in sync.
				</p>
			</header>
			<details className="mb-8 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:hidden">
				<summary className="cursor-pointer text-sm font-medium text-slate-700">
					On this page
				</summary>
				<nav
					aria-label="Mobile table of contents"
					className="mt-3 grid gap-2 text-sm"
				>
					{referenceToc
						.filter((entry) => entry.level === 2)
						.map((entry) => (
							<a
								key={entry.id}
								href={`#reference/${entry.id}`}
								className="text-teal-700 hover:underline"
							>
								{entry.text}
							</a>
						))}
				</nav>
			</details>
			<div className="mx-auto flex gap-10">
				<nav
					className="hidden w-56 shrink-0 lg:block"
					aria-label="Table of contents"
				>
					<div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-8">
						<p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
							On this page
						</p>
						<ul className="space-y-1 border-l border-slate-200 text-sm">
							{referenceToc.map((entry) => (
								<li key={entry.id}>
									<a
										href={`#reference/${entry.id}`}
										className={`-ml-px block border-l py-1 leading-snug [overflow-wrap:anywhere] ${
											entry.level === 3 ? "pl-7" : "pl-4"
										} ${
											activeId === entry.id
												? "border-teal-600 font-medium text-teal-700"
												: "border-transparent text-slate-500 hover:border-slate-400 hover:text-slate-900"
										}`}
									>
										{entry.text}
									</a>
								</li>
							))}
						</ul>
					</div>
				</nav>
				<article
					ref={articleRef}
					className="reference-prose prose prose-slate min-w-0 max-w-[52rem] flex-1 pb-16 prose-headings:scroll-mt-24 prose-a:text-teal-700 prose-pre:border prose-pre:border-slate-700/60 prose-pre:bg-slate-950 prose-pre:text-slate-100 prose-pre:shadow-sm prose-code:before:content-none prose-code:after:content-none"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: rendering our own README from this repo, not user input
					dangerouslySetInnerHTML={{ __html: referenceHtml }}
				/>
			</div>
		</>
	);
}
