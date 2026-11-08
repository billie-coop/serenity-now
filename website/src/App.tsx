import { useEffect, useState } from "react";
import { Overview } from "./components/Overview";
import { Reference } from "./components/Reference";

type View = "overview" | "reference";

/** Preserve the existing hash routes, including README section deep links. */
function useHashView(): View {
	const [hash, setHash] = useState(() => window.location.hash);
	useEffect(() => {
		const onChange = () => setHash(window.location.hash);
		window.addEventListener("hashchange", onChange);
		return () => window.removeEventListener("hashchange", onChange);
	}, []);
	return hash.startsWith("#reference") ? "reference" : "overview";
}

function ThemeToggle() {
	const [theme, setTheme] = useState(() =>
		document.documentElement.dataset.theme === "light" ? "light" : "dark",
	);
	const nextTheme = theme === "dark" ? "light" : "dark";
	return (
		<button
			type="button"
			className="theme-toggle"
			aria-label={`Switch to ${nextTheme} mode`}
			title={`Switch to ${nextTheme} mode`}
			onClick={() => {
				const root = document.documentElement;
				root.dataset.theme = nextTheme;
				root.classList.toggle("dark", nextTheme === "dark");
				root.style.colorScheme = nextTheme;
				setTheme(nextTheme);
				try {
					localStorage.setItem("billie-coop-theme", nextTheme);
				} catch {
					// Keep the switch working even when storage is unavailable.
				}
			}}
		>
			{nextTheme === "light" ? "Light" : "Dark"}
		</button>
	);
}

function NavBar({ view }: { view: View }) {
	return (
		<header className="site-header">
			<div className="site-container site-header-inner">
				<a href="#overview" className="site-brand">
					<strong>serenity-now</strong>
					<span>by Billie co-op</span>
				</a>
				<nav aria-label="Main navigation" className="site-nav">
					<a
						href="#overview"
						aria-current={view === "overview" ? "page" : undefined}
					>
						Overview
					</a>
					<a
						href="#reference"
						aria-current={view === "reference" ? "page" : undefined}
					>
						Docs
					</a>
					<a href="https://github.com/billie-coop/serenity-now">GitHub ↗</a>
					<ThemeToggle />
				</nav>
			</div>
		</header>
	);
}

function Footer() {
	return (
		<footer className="site-container site-footer">
			<p>
				Made at <a href="https://github.com/billie-coop">Billie co-op</a> ·{" "}
				<a href="https://github.com/billie-coop/serenity-now/blob/main/LICENSE">
					MIT
				</a>
			</p>
			<nav aria-label="Billie co-op projects">
				<a href="https://billie-coop.github.io/seaq/">seaq</a>
				<a
					href="https://billie-coop.github.io/serenity-now/"
					aria-current="true"
				>
					serenity-now
				</a>
				<a href="https://billie-coop.github.io/hereabouts/">hereabouts</a>
			</nav>
		</footer>
	);
}

export function App() {
	const view = useHashView();

	useEffect(() => {
		if (view === "overview") window.scrollTo({ top: 0 });
	}, [view]);

	return (
		<div className="site-shell">
			<button
				type="button"
				className="skip-link"
				onClick={() => {
					const main = document.getElementById("main-content");
					main?.focus();
					main?.scrollIntoView();
				}}
			>
				Skip to content
			</button>
			<NavBar view={view} />
			<main
				id="main-content"
				className="site-container site-main"
				tabIndex={-1}
			>
				{view === "reference" ? <Reference /> : <Overview />}
			</main>
			<Footer />
		</div>
	);
}
