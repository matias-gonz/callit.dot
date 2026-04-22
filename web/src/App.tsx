import { Outlet, Link, useLocation } from "react-router-dom";
import { useChainStore } from "./store/chainStore";
import { useUiStore } from "./store/uiStore";
import { useConnectionManagement } from "./hooks/useConnection";

export default function App() {
	const location = useLocation();
	const connected = useChainStore((s) => s.connected);
	const settingsOpen = useUiStore((s) => s.settingsOpen);
	const toggleSettings = useUiStore((s) => s.toggleSettings);

	useConnectionManagement();

	const navItems = [
		{ path: "/markets", label: "Markets", enabled: true },
		{ path: "/evm", label: "EVM PoE", enabled: true },
		{ path: "/pvm", label: "PVM PoE", enabled: true },
		{ path: "/accounts", label: "Accounts", enabled: true },
	];

	return (
		<div className="min-h-screen bg-pattern relative">
			<div
				className="gradient-orb"
				style={{ background: "#e6007a", top: "-240px", right: "-160px" }}
			/>
			<div
				className="gradient-orb"
				style={{ background: "#4cc2ff", bottom: "-240px", left: "-160px" }}
			/>

			<nav className="sticky top-0 z-40 border-b border-white/[0.05] backdrop-blur-xl bg-surface-950/70">
				<div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-8">
					<Link to="/markets" className="flex items-center gap-2.5 shrink-0 group">
						<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-polka-500 to-polka-700 flex items-center justify-center shadow-glow transition-shadow group-hover:shadow-glow-lg">
							<svg viewBox="0 0 16 16" className="w-4 h-4" fill="white">
								<circle cx="8" cy="3" r="2" />
								<circle cx="3" cy="8" r="2" />
								<circle cx="13" cy="8" r="2" />
								<circle cx="8" cy="13" r="2" />
								<circle cx="8" cy="8" r="1.5" opacity="0.6" />
							</svg>
						</div>
						<span className="text-base font-semibold text-text-primary font-display tracking-tight">
							Callit
						</span>
					</Link>

					<div className="flex gap-1 overflow-x-auto">
						{navItems.map((item) =>
							item.enabled ? (
								<Link
									key={item.path}
									to={item.path}
									className={`relative px-3.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap ${
										location.pathname === item.path ||
										(item.path === "/markets" && location.pathname === "/")
											? "text-white"
											: "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
									}`}
								>
									{(location.pathname === item.path ||
										(item.path === "/markets" &&
											location.pathname === "/")) && (
										<span className="absolute inset-0 rounded-md bg-white/[0.06] border border-white/[0.08]" />
									)}
									<span className="relative">{item.label}</span>
								</Link>
							) : (
								<span
									key={item.path}
									className="px-3.5 py-1.5 rounded-md text-sm font-medium text-text-muted cursor-not-allowed whitespace-nowrap"
									title="Pallet not available on connected chain"
								>
									{item.label}
								</span>
							),
						)}
					</div>

					<div className="ml-auto flex items-center gap-2 shrink-0">
						<div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] pl-2.5 pr-3 py-1">
							<span
								className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
									connected
										? "bg-accent-green shadow-[0_0_8px_rgba(52,211,153,0.7)]"
										: "bg-text-muted"
								}`}
							/>
							<span className="text-xs text-text-tertiary">
								{connected ? "Live" : "Offline"}
							</span>
						</div>
						<button
							onClick={toggleSettings}
							aria-label={settingsOpen ? "Close settings" : "Open settings"}
							title={settingsOpen ? "Close settings" : "Settings"}
							className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-all ${
								settingsOpen
									? "border-accent-purple/40 bg-accent-purple/15 text-accent-purple"
									: "border-white/[0.08] bg-white/[0.03] text-text-secondary hover:border-white/[0.15] hover:text-text-primary"
							}`}
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<circle cx="12" cy="12" r="3" />
								<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
							</svg>
						</button>
					</div>
				</div>
			</nav>

			<main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
				<Outlet />
			</main>
		</div>
	);
}
