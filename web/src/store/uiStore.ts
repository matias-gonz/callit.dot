import { create } from "zustand";

interface UiState {
	settingsOpen: boolean;
	setSettingsOpen: (open: boolean) => void;
	toggleSettings: () => void;
}

export const useUiStore = create<UiState>((set) => ({
	settingsOpen: false,
	setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
	toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
}));
