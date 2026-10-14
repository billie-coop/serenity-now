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
			{ rootMargin: "-64px 0px -75% 0px" },
		);
		for (const h of root.querySelectorAll("h2, h3")) observer.observe(h);
		return () => observer.disconnect();
	}, []);

	return (
		<div className="mx-auto flex max-w-7xl gap-10">
			<nav
				className="hidden w-56 shrink-0 lg:block"
				aria-label="Table of contents"
			>
				<div className="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto pb-8">
					<p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
						On this page
					</p>
					<ul className="space-y-1 border-l border-gray-200 text-sm dark:border-gray-800">
						{referenceToc.map((entry) => (
							<li key={entry.id}>
								<a
									href={`#reference/${entry.id}`}
									className={`-ml-px block border-l py-1 leading-snug [overflow-wrap:anywhere] ${
										entry.level === 3 ? "pl-7" : "pl-4"
									} ${
										activeId === entry.id
											? "border-teal-600 font-medium text-teal-700 dark:border-teal-400 dark:text-teal-300"
											: "border-transparent text-gray-500 hover:border-gray-400 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
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
				className="reference-prose prose prose-gray min-w-0 max-w-[52rem] flex-1 pb-16 dark:prose-invert prose-headings:scroll-mt-20 prose-a:text-teal-700 dark:prose-a:text-teal-300 prose-pre:border prose-pre:border-gray-700/60 prose-pre:bg-gray-950 prose-pre:text-gray-100 prose-pre:shadow-sm prose-code:before:content-none prose-code:after:content-none"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: rendering our own README from this repo, not user input
				dangerouslySetInnerHTML={{ __html: referenceHtml }}
			/>
		</div>
	);
}
