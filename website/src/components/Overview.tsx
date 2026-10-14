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
			className="group flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 font-mono text-sm text-gray-100 shadow-sm hover:bg-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700"
		>
			<span className="text-gray-500">$</span> {command}
			<span className="text-xs text-gray-400 group-hover:text-gray-200">
				{copied ? "✓ copied" : "copy"}
			</span>
		</button>
	);
}

function Hero() {
	return (
		<section className="grid grid-cols-1 gap-10 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
			<div>
				<h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl dark:text-white">
					serenity-now
				</h1>
				<p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
					Keeps your TypeScript monorepo's workspace dependencies, tsconfig{" "}
					<code className="text-base">paths</code> and project{" "}
					<code className="text-base">references</code> in sync with the imports
					your code actually uses.
				</p>
				<div className="mt-6 flex flex-wrap items-center gap-3">
					<CopyCommand command="npx serenity-now" />
					<a
						href="#reference"
						className="rounded-md px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-gray-800"
					>
						Read the docs →
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
		<section className="py-12">
			<h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
				Three files that have to agree
			</h2>
			<p className="mt-2 max-w-3xl text-gray-600 dark:text-gray-300">
				serenity-now reads the import and rewrites the other two to match.
			</p>
			<div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
				{THREE_FILES.map((f) => (
					<div
						key={f.file}
						className="flex flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
					>
						<p className="border-b border-gray-200 px-4 py-2.5 font-mono text-xs text-gray-600 dark:border-gray-800 dark:text-gray-300">
							{f.file}
						</p>
						<pre className="flex-1 overflow-x-auto bg-gray-950 px-4 py-3 font-mono text-xs leading-relaxed text-gray-100">
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
		<section className="py-12">
			<h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
				Commands
			</h2>
			<div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
				{DOCS.commands.map((c) => (
					<div
						key={c.name}
						className="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
					>
						<code className="font-mono text-sm font-semibold text-teal-700 dark:text-teal-300">
							npx serenity-now{c.name === "sync" ? "" : ` ${c.name}`}
						</code>
						<p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300">
							{c.description}
						</p>
					</div>
				))}
			</div>
			<p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
				Add <code>--dry-run</code> to preview a sync, or <code>--check</code> to
				fail CI when anything is out of sync.{" "}
				<a
					href="#reference/commands"
					className="font-medium text-teal-700 hover:underline dark:text-teal-300"
				>
					All options →
				</a>
			</p>
		</section>
	);
}

function Footer() {
	return (
		<footer className="mt-8 flex flex-col items-center gap-4 border-t border-gray-200 py-12 text-center dark:border-gray-800">
			<img
				src={gif}
				alt="Frank Costanza yelling &quot;Serenity now!&quot;"
				width={280}
				className="rounded-lg"
				loading="lazy"
			/>
			<p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
				Because keeping monorepo dependencies in sync by hand will have you
				yelling <strong>"SERENITY NOW!"</strong> at your monitor.
			</p>
			<p className="text-xs text-gray-400 dark:text-gray-500">
				MIT licensed. Made at{" "}
				<a
					href="https://github.com/billie-coop"
					className="hover:text-gray-600 dark:hover:text-gray-300"
				>
					billie-coop
				</a>
				.
			</p>
		</footer>
	);
}

export function Overview() {
	return (
		<>
			<Hero />
			<ThreeFiles />
			<Commands />
			<Footer />
		</>
	);
}
