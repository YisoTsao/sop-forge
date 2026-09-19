import { StrictMode, useEffect, useState, startTransition } from "react";
import { createRoot } from "react-dom/client";
import type { Project } from "../../../packages/domain/src/index.js";
import "./styles.css";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Request failed");
  return payload;
}

function statusLabel(status: Project["status"] | "idle"): string {
  return {
    idle: "Ready to record",
    starting: "Opening browser",
    recording: "Recording live",
    stopping: "Saving steps",
    completed: "Recording complete",
    failed: "Needs attention",
    interrupted: "Browser closed",
  }[status];
}

export function App() {
  const [url, setUrl] = useState("https://");
  const [status, setStatus] = useState<Project["status"] | "idle">("idle");
  const [project, setProject] = useState<Project | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws/${sessionId}`,
    );
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as {
        type: string;
        status?: Project["status"];
        projectId?: string;
      };
      if (message.status) setStatus(message.status);
      if (message.type === "step" && message.projectId) {
        request<Project>(`/api/projects/${message.projectId}`)
          .then((nextProject) => startTransition(() => setProject(nextProject)))
          .catch(() => undefined);
      }
    };
    socket.onerror = () =>
      setError(
        "Live recording connection lost. The browser session may still be running.",
      );
    return () => socket.close();
  }, [sessionId]);

  async function startRecording(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus("starting");
    try {
      const recording = await request<{ sessionId: string; projectId: string }>(
        "/api/sessions",
        { method: "POST", body: JSON.stringify({ url }) },
      );
      setSessionId(recording.sessionId);
      setProject(
        await request<Project>(`/api/projects/${recording.projectId}`),
      );
      setStatus("recording");
    } catch (reason) {
      setStatus("idle");
      setError(
        reason instanceof Error ? reason.message : "Unable to start recording.",
      );
    }
  }

  async function stopRecording() {
    if (!sessionId) return;
    setError(null);
    setStatus("stopping");
    try {
      setProject(
        await request<Project>(`/api/sessions/${sessionId}/stop`, {
          method: "POST",
        }),
      );
      setStatus("completed");
      setSessionId(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to stop recording.",
      );
      setStatus("failed");
    }
  }

  async function exportProjectPdf() {
    if (!project) return;
    setError(null);
    try {
      const result = await request<{ url: string }>(
        `/api/projects/${project.id}/pdf`,
        { method: "POST" },
      );
      window.open(result.url, "_blank");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to export PDF.",
      );
    }
  }

  async function exportProjectImages(format: "folder" | "zip") {
    if (!project || !window.sopForgeDesktop) return;
    setError(null);
    setExportStatus("Preparing image export...");
    try {
      const result = (await window.sopForgeDesktop.exportProjectImages(
        project.id,
        format,
      )) as {
        status: "completed" | "partial" | "cancelled";
        copied: number;
        skipped: number;
        failed: number;
      };
      if (result.status === "cancelled") {
        setExportStatus("Image export cancelled.");
        return;
      }
      setExportStatus(
        `Exported ${result.copied} image${result.copied === 1 ? "" : "s"}` +
          (result.skipped || result.failed
            ? `, skipped ${result.skipped}, failed ${result.failed}`
            : "."),
      );
    } catch (reason) {
      setExportStatus(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to export project images.",
      );
    }
  }

  const editUrl = project ? `/api/projects/${project.id}/edit` : "";
  const assetsById = new Map(
    project?.assets.map((asset) => [asset.id, asset]) ?? [],
  );
  const previewSteps =
    project?.steps.slice().sort((left, right) => left.order - right.order) ??
    [];
  const previewImages = new Set<string>();

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark">SF</div>
        <div>
          <div className="eyebrow">LOCAL SOP STUDIO</div>
          <div className="brand-name">SOP Forge</div>
        </div>
        <div className="topbar-spacer" />
        <div className={`status-pill status-${status}`}>
          <span className="status-dot" />
          {statusLabel(status)}
        </div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy">
          <p className="kicker">Capture the work, explain the path</p>
          <h1>Turn a real browser session into a clear SOP.</h1>
          <p className="hero-text">
            Enter a starting URL, operate the site in the recording browser, and
            shape every captured moment into a document your team can actually
            follow.
          </p>
          <form className="record-form" onSubmit={startRecording}>
            <label htmlFor="record-url">Starting URL</label>
            <div className="url-row">
              <input
                id="record-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://app.example.com"
                disabled={status === "recording" || status === "starting"}
              />
              <button
                type="submit"
                disabled={
                  status === "recording" ||
                  status === "starting" ||
                  status === "stopping"
                }
              >
                {status === "recording" ? "Recording" : "Start recording"}{" "}
                <span>↗</span>
              </button>
            </div>
          </form>
          {status === "recording" && (
            <button
              type="button"
              className="stop-button"
              onClick={stopRecording}
            >
              Stop and save session
            </button>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="hero-card">
          <div className="card-topline">
            <span>SESSION FLOW</span>
            <span>
              {project ? `${project.steps.length} steps` : "No session yet"}
            </span>
          </div>
          <div className="flow-visual">
            <div className="flow-node active">
              <span>01</span>
              <strong>Browser</strong>
              <small>Operate the site</small>
            </div>
            <div className="flow-line" />
            <div className="flow-node">
              <span>02</span>
              <strong>Steps</strong>
              <small>Edit the story</small>
            </div>
            <div className="flow-line" />
            <div className="flow-node">
              <span>03</span>
              <strong>Document</strong>
              <small>HTML or PDF</small>
            </div>
          </div>
          <div className="card-footer">
            <span className="pulse" /> Your actions stay on this machine
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="SOP workspace">
        <div className="workspace-heading">
          <div>
            <p className="kicker">02 · AUTHOR</p>
            <h2>{project?.title ?? "Your captured steps will appear here"}</h2>
          </div>
          <div className="workspace-actions">
            {project && (
              <>
                <a
                  className="outline-button"
                  href={editUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Preview/edit HTML ↗
                </a>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void exportProjectPdf()}
                >
                  Export PDF ↓
                </button>
                {window.sopForgeDesktop && (
                  <>
                    <button
                      className="outline-button"
                      type="button"
                      onClick={() => void exportProjectImages("folder")}
                    >
                      Download images
                    </button>
                    <button
                      className="outline-button"
                      type="button"
                      onClick={() => void exportProjectImages("zip")}
                    >
                      Download ZIP
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {exportStatus && (
          <div className="workspace-status" role="status">
            {exportStatus}
          </div>
        )}
        <div className="workspace-preview-only">
          <aside className="preview-panel">
            <div className="preview-header">
              <span>LIVE PREVIEW</span>
              <span className="preview-device">A4</span>
            </div>
            {project ? (
              <div className="preview-thumbnails">
                {previewSteps.map((step, index) => {
                  const asset = step.screenshotAssetId
                    ? assetsById.get(step.screenshotAssetId)
                    : undefined;
                  const imageSrc =
                    asset?.status === "ready" && asset.relativePath
                      ? `/api/assets/${asset.relativePath}`
                      : undefined;
                  const repeated = imageSrc
                    ? previewImages.has(imageSrc)
                    : false;
                  if (imageSrc) previewImages.add(imageSrc);
                  return (
                    <article className="preview-thumbnail" key={step.id}>
                      <div className="preview-thumbnail-meta">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{step.action}</strong>
                      </div>
                      {imageSrc && !repeated ? (
                        <img
                          src={imageSrc}
                          alt={`Preview screenshot for step ${index + 1}`}
                        />
                      ) : repeated ? (
                        <div className="preview-repeat">
                          Same screenshot as above
                        </div>
                      ) : (
                        <div className="preview-missing">
                          Screenshot unavailable
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="preview-placeholder">
                <span>◌</span>
                <p>Document preview</p>
                <small>It will update as your recording takes shape.</small>
              </div>
            )}
          </aside>
        </div>
      </section>
      <footer className="footer">
        <span>SOP Forge · local-first workflow recorder</span>
        <span>Playwright capture · HTML renderer · PDF export</span>
      </footer>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
