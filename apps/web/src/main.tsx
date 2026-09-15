import { StrictMode, useEffect, useState, startTransition } from "react";
import { createRoot } from "react-dom/client";
import type { Project, Step } from "../../../packages/domain/src/index.js";
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

function StepCard({
  step,
  asset,
  index,
  count,
  onChange,
  onMove,
  onDelete,
}: {
  step: Step;
  asset?: Project["assets"][number];
  index: number;
  count: number;
  onChange: (patch: Partial<Step>) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const thumbnailSrc =
    asset?.status === "ready" && asset.relativePath
      ? `/api/assets/${asset.relativePath}`
      : undefined;

  return (
    <article className="step-card">
      <div className="step-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="step-body">
        <div className="step-toolbar">
          <span className="action-label">{step.action}</span>
          <div className="icon-actions">
            <button
              type="button"
              aria-label="Move step up"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move step down"
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Delete step"
              className="quiet-danger"
              onClick={onDelete}
            >
              ×
            </button>
          </div>
        </div>
        <input
          className="step-title"
          value={step.title}
          onChange={(event) => onChange({ title: event.target.value })}
          aria-label={`Step ${index + 1} title`}
        />
        <textarea
          value={step.description}
          onChange={(event) => onChange({ description: event.target.value })}
          aria-label={`Step ${index + 1} description`}
          rows={2}
        />
        {thumbnailSrc ? (
          <img
            className="step-thumbnail"
            src={thumbnailSrc}
            alt={`Screenshot for step ${index + 1}`}
          />
        ) : null}
        {step.screenshotAssetId && asset?.status === "unavailable" ? (
          <div className="asset-note missing">Screenshot unavailable</div>
        ) : step.screenshotAssetId ? (
          <div className="asset-note">
            Screenshot captured · {step.screenshotAssetId.slice(-8)}
          </div>
        ) : (
          <div className="asset-note missing">No screenshot available</div>
        )}
      </div>
    </article>
  );
}

export function App() {
  const [url, setUrl] = useState("https://");
  const [status, setStatus] = useState<Project["status"] | "idle">("idle");
  const [project, setProject] = useState<Project | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingPreviewStepId, setEditingPreviewStepId] = useState<
    string | null
  >(null);
  const [previewDraft, setPreviewDraft] = useState({
    title: "",
    description: "",
  });

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

  async function saveSteps(steps: Step[]) {
    if (!project) return;
    setSaving(true);
    try {
      const saved = await request<Project>(
        `/api/projects/${project.id}/steps`,
        { method: "PATCH", body: JSON.stringify({ steps }) },
      );
      setProject(saved);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save step changes.",
      );
    } finally {
      setSaving(false);
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

  function updateStep(stepId: string, patch: Partial<Step>) {
    if (!project) return;
    const steps = project.steps.map((step) =>
      step.id === stepId ? { ...step, ...patch } : step,
    );
    setProject({ ...project, steps });
  }

  function beginPreviewEdit(step: Step) {
    setEditingPreviewStepId(step.id);
    setPreviewDraft({ title: step.title, description: step.description });
  }

  function cancelPreviewEdit() {
    setEditingPreviewStepId(null);
    setPreviewDraft({ title: "", description: "" });
  }

  async function savePreviewEdit(stepId: string) {
    if (!project || !previewDraft.title.trim()) return;
    const steps = project.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            title: previewDraft.title.trim(),
            description: previewDraft.description,
          }
        : step,
    );
    setProject({ ...project, steps });
    cancelPreviewEdit();
    await saveSteps(steps);
  }

  async function removePreviewStep(stepId: string) {
    if (!project || !window.confirm("Remove this step from the SOP?")) return;
    const steps = project.steps
      .filter((step) => step.id !== stepId)
      .map((step, order) => ({ ...step, order }));
    setProject({ ...project, steps });
    cancelPreviewEdit();
    await saveSteps(steps);
  }

  function moveStep(index: number, direction: -1 | 1): Step[] | null {
    if (!project) return null;
    const steps = [...project.steps];
    const target = index + direction;
    if (target < 0 || target >= steps.length) return null;
    [steps[index], steps[target]] = [steps[target]!, steps[index]!];
    const reordered = steps.map((step, order) => ({ ...step, order }));
    setProject({ ...project, steps: reordered });
    return reordered;
  }

  const previewUrl = project ? `/api/projects/${project.id}/preview` : "";
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
            {saving && <span className="saving-label">Saving…</span>}
            {project && (
              <>
                <a
                  className="outline-button"
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Preview HTML ↗
                </a>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void exportProjectPdf()}
                >
                  Export PDF ↓
                </button>
              </>
            )}
          </div>
        </div>
        <div className="workspace-grid">
          <div className="steps-column">
            {project?.steps.length ? (
              project.steps
                .slice()
                .sort((left, right) => left.order - right.order)
                .map((step, index, steps) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    asset={
                      step.screenshotAssetId
                        ? assetsById.get(step.screenshotAssetId)
                        : undefined
                    }
                    index={index}
                    count={steps.length}
                    onChange={(patch) => updateStep(step.id, patch)}
                    onMove={(direction) => {
                      const reordered = moveStep(index, direction);
                      if (reordered) void saveSteps(reordered);
                    }}
                    onDelete={() => {
                      const steps = project.steps
                        .filter((candidate) => candidate.id !== step.id)
                        .map((candidate, order) => ({ ...candidate, order }));
                      setProject({ ...project, steps });
                      void saveSteps(steps);
                    }}
                  />
                ))
            ) : (
              <div className="empty-state">
                <div className="empty-icon">◎</div>
                <h3>Waiting for your first action</h3>
                <p>
                  Start a recording and use the separate browser window. Each
                  meaningful click, input, and navigation will become an
                  editable step here.
                </p>
              </div>
            )}
            {project && project.steps.length > 0 && (
              <button
                className="save-button"
                type="button"
                onClick={() => void saveSteps(project.steps)}
              >
                Save step edits
              </button>
            )}
          </div>
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
                        <button
                          type="button"
                          className="preview-edit-button"
                          aria-label={`Edit step ${index + 1}`}
                          onClick={() => beginPreviewEdit(step)}
                        >
                          Edit
                        </button>
                      </div>
                      {editingPreviewStepId === step.id ? (
                        <div className="preview-editor">
                          <label>
                            Title
                            <input
                              aria-label={`Preview step ${index + 1} title`}
                              value={previewDraft.title}
                              onChange={(event) =>
                                setPreviewDraft({
                                  ...previewDraft,
                                  title: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Content
                            <textarea
                              aria-label={`Preview step ${index + 1} content`}
                              value={previewDraft.description}
                              onChange={(event) =>
                                setPreviewDraft({
                                  ...previewDraft,
                                  description: event.target.value,
                                })
                              }
                              rows={4}
                            />
                          </label>
                          <div className="preview-editor-actions">
                            <button
                              type="button"
                              className="preview-save-button"
                              disabled={!previewDraft.title.trim() || saving}
                              onClick={() => void savePreviewEdit(step.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="preview-cancel-button"
                              onClick={cancelPreviewEdit}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="preview-remove-button"
                              aria-label={`Remove preview step ${index + 1}`}
                              onClick={() => void removePreviewStep(step.id)}
                            >
                              Remove step
                            </button>
                          </div>
                        </div>
                      ) : null}
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
