import { useState } from "react";
import { DEMOS, type Demo } from "../demos";

/** Color a line of CLI output the way the terminal would. */
function lineClass(line: string): string {
	if (line.startsWith("═══")) return "font-semibold text-cyan-300";
	if (line.startsWith("  +")) return "text-emerald-300";
	if (line.startsWith("  -") && line.endsWith("(not imported)"))
		return "text-rose-300";
	if (line.startsWith("✗") || line.startsWith("Use --force"))
		return "text-rose-300";
	if (line.startsWith("✓") || line.startsWith("✅")) return "text-emerald-300";
	if (line.startsWith("→")) return "text-gray-400";
	return "text-gray-200";
}

function editLineClass(line: string): string {
	if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-300";
	if (line.startsWith("-")) return "bg-rose-500/10 text-rose-300";
	return "text-gray-400";
}

function DemoBody({ demo }: { demo: Demo }) {
	return (
		<div className="max-h-[30rem] overflow-auto p-4 font-mono text-xs leading-relaxed">
			{demo.edit && (
				<div className="mb-4 rounded-md border border-gray-700/70">
					<div className="border-b border-gray-700/70 px-3 py-1.5 text-[11px] text-gray-400">
						{demo.edit.file}
					</div>
					<pre className="py-1.5">
						{demo.edit.lines.map((line) => (
							<div key={line} className={`px-3 ${editLineClass(line)}`}>
								{line}
							</div>
						))}
					</pre>
				</div>
			)}
			<pre>
				<div>
					<span className="select-none text-teal-400">$ </span>
					<span className="text-white">{demo.command}</span>
				</div>
				{demo.output.split("\n").map((line, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static output, lines repeat
					<div key={i} className={lineClass(line)}>
						{line || " "}
					</div>
				))}
			</pre>
		</div>
	);
}

/** Tabbed, static terminal showing real serenity-now runs. */
export function Terminal() {
	const [activeId, setActiveId] = useState(DEMOS[0]?.id);
	const demo = DEMOS.find((d) => d.id === activeId) ?? DEMOS[0];
	if (!demo) return null;

	return (
		<div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950 shadow-xl">
			<div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2">
				<span className="size-3 rounded-full bg-rose-500/80" />
				<span className="size-3 rounded-full bg-amber-400/80" />
				<span className="size-3 rounded-full bg-emerald-500/80" />
				<span
					className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[11px] ${
						demo.exitCode === 0
							? "bg-emerald-500/15 text-emerald-300"
							: "bg-rose-500/15 text-rose-300"
					}`}
				>
					exit {demo.exitCode}
				</span>
			</div>
			<div
				role="tablist"
				aria-label="Example runs"
				className="flex gap-1 overflow-x-auto border-b border-gray-800 px-2 py-1.5"
			>
				{DEMOS.map((d) => (
					<button
						key={d.id}
						type="button"
						role="tab"
						aria-selected={d.id === demo.id}
						onClick={() => setActiveId(d.id)}
						className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${
							d.id === demo.id
								? "bg-gray-800 text-white"
								: "text-gray-400 hover:text-gray-200"
						}`}
					>
						{d.label}
					</button>
				))}
			</div>
			<DemoBody demo={demo} />
		</div>
	);
}
