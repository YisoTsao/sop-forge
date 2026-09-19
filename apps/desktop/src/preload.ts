import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sopForgeDesktop", {
  isDesktop: true,
  exportProjectImages: (projectId: string, format: "folder" | "zip") =>
    ipcRenderer.invoke("export-project-images", { projectId, format }),
});