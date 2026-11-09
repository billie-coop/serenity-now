import { useState } from "react";
import gif from "../../../serenity-now.gif";
import { DOCS } from "../../../src/docs/content";
import { Terminal } from "./Terminal";

function CopyCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);

	function copy() {
		navigator.clipboard.writeText(command).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}

	return (
		<button
			type="button"
			onClick={copy}
			title="Copy to clipboard"
			className="group flex max-w-full flex-wrap items-center gap-2 text-left rounded-md bg-(--site-surface) px-4 py-2 font-mono text-sm text-(--site-text) shadow-sm hover:bg-(--site-border)"
		>
			<span className="text-(--site-muted)">$</span> {command}
			<span className="text-xs text-(--site-muted) group-hover:text-(--site-text)">
				{copied ? "✓ copied" : "copy"}
			</span>
		</button>
	);
}

function Hero() {
	return (
		<section className="grid grid-cols-1 gap-8 pt-7 pb-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:pt-8 lg:pb-7">
			<div>
				<h1 className="text-3xl font-bold tracking-tight text-(--site-text) sm:text-4xl">
					serenity-now
				</h1>
				<p className="mt-4 text-base text-(--site-muted)">
					Syncs TypeScript monorepo dependencies, tsconfig{" "}
					<code className="text-base">paths</code> and project{" "}
					<code className="text-base">references</code> with your imports.
				</p>
				<div className="mt-6 flex flex-wrap items-center gap-3">
					<CopyCommand command={`npx ${DOCS.npmPackage}`} />
					<a
						href="#reference"
						className="rounded-md px-3 py-2 text-sm font-medium text-(--site-accent) hover:bg-(--site-surface)"
					>
						Docs →
					</a>
				</div>
			</div>
			<Terminal />
		</section>
	);
}

const THREE_FILES = [
	{
		file: "apps/mobile/src/index.ts",
		code: `import { formatDate } from "@example/utils";`,
	},
	{
		file: "apps/mobile/package.json",
		code: `"dependencies": {
  "@example/utils": "workspace:*"
}`,
	},
	{
		file: "apps/mobile/tsconfig.json",
		code: `"paths": {
  "@example/utils": ["../../packages/utils/src/index.ts"]
},
"references": [{ "path": "../../packages/utils" }]`,
	},
];

function ThreeFiles() {
	return (
		<section className="py-8">
			<h2 className="text-2xl font-bold tracking-tight text-(--site-text)">
				Examples
			</h2>
			<div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
				{THREE_FILES.map((f) => (
					<div
						key={f.file}
						className="flex flex-col overflow-hidden rounded-lg border border-(--site-border)"
					>
						<p className="border-b border-(--site-border) px-3 py-2 font-mono text-xs text-(--site-muted)">
							{f.file}
						</p>
						<pre className="flex-1 overflow-x-auto bg-slate-950 px-3 py-2 font-mono text-xs leading-normal text-slate-100">
							{f.code}
						</pre>
					</div>
				))}
			</div>
		</section>
	);
}

function Commands() {
	return (
		<section className="py-8">
			<h2 className="text-2xl font-bold tracking-tight text-(--site-text)">
				Commands
			</h2>
			<div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
				{DOCS.commands.map((c) => (
					<div
						key={c.name}
						className="rounded-lg border border-(--site-border) p-3"
					>
						<code className="font-mono text-sm font-semibold text-(--site-accent)">
							npx {DOCS.npmPackage}
							{c.name === "sync" ? "" : ` ${c.name}`}
						</code>
						<p className="mt-1.5 text-sm text-(--site-muted)">
							{c.description}
						</p>
					</div>
				))}
			</div>
			<p className="mt-4 text-sm text-(--site-muted)">
				Add <code>--dry-run</code> to preview a sync, or <code>--check</code> to
				fail CI when anything is out of sync.{" "}
				<a
					href="#reference/commands"
					className="font-medium text-(--site-accent) hover:underline"
				>
					All options →
				</a>
			</p>
		</section>
	);
}

export function Overview() {
	return (
		<>
			<Hero />
			<ThreeFiles />
			<Commands />
			<div className="mt-8 flex justify-center border-t border-(--site-border) py-8">
				<img
					src={gif}
					alt="Frank Costanza yelling"
					width={280}
					className="rounded-lg"
					loading="lazy"
				/>
			</div>
		</>
	);
}
