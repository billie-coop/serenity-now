import { useEffect, useState } from "react";
import { Overview } from "./components/Overview";
import { Reference } from "./components/Reference";

type View = "overview" | "reference";

/**
 * Hash-based view switching so views are linkable without a router.
 * `#reference` selects the docs view; `#reference/<section>` deep-links
 * into a section (handled inside Reference); anything else is the overview.
 */
function useHashView(): View {
	const [hash, setHash] = useState(() => window.location.hash);
	useEffect(() => {
		const onChange = () => setHash(window.location.hash);
		window.addEventListener("hashchange", onChange);
		return () => window.removeEventListener("hashchange", onChange);
	}, []);
	return hash.startsWith("#reference") ? "reference" : "overview";
}

function NavBar({ view }: { view: View }) {
	const tabClass = (active: boolean) =>
		`rounded-md px-3 py-1.5 text-sm font-medium ${
			active
				? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
				: "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
		}`;
	const external =
		"text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white";
	return (
		<nav className="sticky top-0 z-10 mb-6 flex items-center gap-2 border-b border-gray-200 bg-white/90 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
			<a
				href="#overview"
				className="mr-2 text-lg font-bold text-gray-900 dark:text-white"
			>
				serenity-now
			</a>
			<a href="#overview" className={tabClass(view === "overview")}>
				Overview
			</a>
			<a href="#reference" className={tabClass(view === "reference")}>
				Docs
			</a>
			<div className="ml-auto flex items-center gap-4">
				<a
					href="https://www.npmjs.com/package/serenity-now"
					target="_blank"
					rel="noreferrer"
					className={`hidden sm:inline ${external}`}
				>
					npm ↗
				</a>
				<a
					href="https://github.com/billie-coop/serenity-now"
					target="_blank"
					rel="noreferrer"
					className={external}
				>
					GitHub ↗
				</a>
			</div>
		</nav>
	);
}

export function App() {
	const view = useHashView();

	// The overview always opens at the top, like a fresh page
	useEffect(() => {
		if (view === "overview") window.scrollTo({ top: 0 });
	}, [view]);

	return (
		<div className="mx-auto min-h-screen max-w-7xl bg-white px-4 sm:px-6 dark:bg-gray-900">
			<NavBar view={view} />
			{view === "reference" ? <Reference /> : <Overview />}
		</div>
	);
}
