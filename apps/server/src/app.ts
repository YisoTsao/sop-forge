import path from "node:path";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import fastify, { type FastifyInstance } from "fastify";
import { renderHtml } from "../../../packages/renderer/src/index.js";
import { exportPdf } from "../../../packages/renderer/src/pdf.js";
import {
  createSessionRequestSchema,
  pdfResponseSchema,
  projectListSchema,
  projectSchema,
  sessionResponseSchema,
  type Project,
} from "../../../packages/domain/src/index.js";
import { validateRecordingUrl } from "../../../packages/capture/src/index.js";
import type { RecordingSessionManager } from "../../../packages/recording/src/index.js";
import type { Storage } from "../../../packages/storage/src/index.js";

export interface AppDependencies {
  manager: RecordingSessionManager;
  storage: Storage;
  publicBaseUrl?: string;
}

export async function buildApp(
  dependencies: AppDependencies,
): Promise<FastifyInstance> {
  const app = fastify({ logger: false });
  await app.register(websocket);
  await app.register(staticPlugin, {
    root: dependencies.storage.dataDir,
    prefix: "/api/assets/",
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  app.post<{ Body: { url?: string } }>(
    "/api/sessions",
    async (request, reply) => {
      try {
        const parsedBody = createSessionRequestSchema.safeParse(request.body);
        if (!parsedBody.success)
          return reply.code(400).send({ error: "URL is required." });
        validateRecordingUrl(parsedBody.data.url);
        return reply
          .code(201)
          .send(
            sessionResponseSchema.parse(
              await dependencies.manager.start(parsedBody.data.url),
            ),
          );
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to start recording.",
        });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/stop",
    async (request, reply) => {
      try {
        return reply.send(
          projectSchema.parse(
            await dependencies.manager.stop(request.params.sessionId),
          ),
        );
      } catch (error) {
        return reply.code(404).send({
          error:
            error instanceof Error
              ? error.message
              : "Recording session not found.",
        });
      }
    },
  );

  app.get("/api/projects", async () =>
    projectListSchema.parse(dependencies.storage.projects.list()),
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (request, reply) => {
      const project = dependencies.storage.projects.load(
        request.params.projectId,
      );
      if (!project)
        return reply.code(404).send({ error: "Project not found." });
      return reply.send(projectSchema.parse(project));
    },
  );

  app.patch<{
    Params: { projectId: string };
    Body: { steps?: Project["steps"] };
  }>("/api/projects/:projectId/steps", async (request, reply) => {
    const project = dependencies.storage.projects.load(
      request.params.projectId,
    );
    if (!project || !request.body?.steps)
      return reply.code(400).send({ error: "Project and steps are required." });
    const parsed = projectSchema.safeParse({
      ...project,
      steps: request.body.steps,
      updatedAt: new Date().toISOString(),
    });
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid step payload." });
    const updated: Project = parsed.data;
    dependencies.storage.projects.save(updated);
    return reply.send(updated);
  });

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/preview",
    async (request, reply) => {
      const project = dependencies.storage.projects.load(
        request.params.projectId,
      );
      if (!project)
        return reply.code(404).send({ error: "Project not found." });
      return reply.type("text/html").send(
        renderHtml(project, "/api/assets/"),
      );
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/edit",
    async (request, reply) => {
      const project = dependencies.storage.projects.load(
        request.params.projectId,
      );
      if (!project)
        return reply.code(404).send({ error: "Project not found." });
      return reply.type("text/html").send(
        renderHtml(project, "/api/assets/", {
          editable: true,
          stepsApiUrl: `/api/projects/${project.id}/steps`,
          pdfUrl: `/api/projects/${project.id}/pdf`,
        }),
      );
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/pdf",
    async (request, reply) => {
      const project = dependencies.storage.projects.load(
        request.params.projectId,
      );
      if (!project)
        return reply.code(404).send({ error: "Project not found." });
      const assetPrefix = `${dependencies.publicBaseUrl ?? "http://127.0.0.1:3001"}/api/assets/`;
      const html = renderHtml(project, assetPrefix);
      const outputPath = path.join(
        dependencies.storage.dataDir,
        "projects",
        project.id,
        "sop.pdf",
      );
      try {
        await exportPdf(
          html,
          outputPath,
          dependencies.publicBaseUrl ?? "http://127.0.0.1:3001",
        );
        return reply.send(
          pdfResponseSchema.parse({
            path: outputPath,
            url: `/api/assets/projects/${project.id}/sop.pdf`,
          }),
        );
      } catch (error) {
        return reply.code(500).send({
          error: error instanceof Error ? error.message : "PDF export failed.",
        });
      }
    },
  );

  app.register(async (websocketApp) => {
    websocketApp.get<{ Params: { sessionId: string } }>(
      "/ws/:sessionId",
      { websocket: true },
      (socket, request) => {
        let unsubscribe: (() => void) | undefined;
        try {
          unsubscribe = dependencies.manager.subscribe(
            request.params.sessionId,
            (message) => socket.send(JSON.stringify(message)),
          );
        } catch (error) {
          socket.send(
            JSON.stringify({
              type: "error",
              error:
                error instanceof Error ? error.message : "Session not found.",
            }),
          );
          socket.close();
        }
        socket.on("close", () => unsubscribe?.());
      },
    );
  });

  return app;
}
