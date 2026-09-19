interface Window {
	sopForgeDesktop?: {
		isDesktop: boolean;
		exportProjectImages: (
			projectId: string,
			format: "folder" | "zip",
		) => Promise<unknown>;
	};
}
/// <reference types="vite/client" />
