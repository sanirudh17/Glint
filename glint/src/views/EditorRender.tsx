/**
 * EditorRender — a hidden window that renders `.glint` documents for agents
 * (Glint MCP → control channel → here). It mounts the real EditorStage and uses
 * the same `flatten` as the editor's Export button, so agent output is
 * pixel-identical to a manual export. Jobs are pulled one at a time from native
 * (`render_job_next`), so a job can never be lost to a not-yet-mounted listener.
 */
import { useEffect, useRef } from "react";
import type Konva from "konva";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EditorStage } from "./editor/EditorStage";
import { useEditorStore, type SerializedDoc } from "../editor/useEditorStore";
import { flatten } from "../editor/flatten";
import { nextPaint } from "../overlay/nextPaint";
import { prepareCaptions } from "../recorder/studioPolish";
import { prepareAnnotations } from "../recorder/videoAnnotations";
import { studioLayout } from "../recorder/studioLayout";
import { hydrateLook } from "../look/model";
import type { StudioProject } from "../recorder/studioModel";

interface ImageJob {
  id: number;
  kind: "image";
  image_data_url: string;
  width: number;
  height: number;
  doc: SerializedDoc | null;
}
/** Rasterize a Studio project's captions and marks for the native exporter —
 *  the same preparation the Trim window does before exporting. */
interface PrepareVideoJob {
  id: number;
  kind: "prepare-video";
  project: StudioProject;
  width: number;
  height: number;
}
type RenderJob = ImageJob | PrepareVideoJob;

async function prepareVideo(job: PrepareVideoJob): Promise<StudioProject> {
  const layout = studioLayout(job.width, job.height, job.project.crop ?? null, hydrateLook(job.project.look));
  const captioned = await prepareCaptions(job.project);
  return { ...captioned, annotations: await prepareAnnotations(job.project.annotations, layout.width / layout.height) };
}

const READY_TIMEOUT_MS = 15_000;

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The document's image could not be decoded."));
    image.src = src;
  });
}

/** Resolve once the Look plate is rendered and every Konva image has decoded. */
async function settled(stage: () => Konva.Stage | null): Promise<Konva.Stage> {
  const started = performance.now();
  for (;;) {
    const current = stage();
    const lookBusy = useEditorStore.getState().renderingLook;
    const imagesBusy = current
      ? current.find("Image").some((node) => {
          const image = (node as Konva.Image).image() as HTMLImageElement | undefined;
          return !image || (image instanceof HTMLImageElement && !image.complete);
        })
      : true;
    if (current && !lookBusy && !imagesBusy) {
      await nextPaint();
      await nextPaint();
      current.draw();
      return current;
    }
    if (performance.now() - started > READY_TIMEOUT_MS) throw new Error("Rendering timed out waiting for images to load.");
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function EditorRender() {
  const stageRef = useRef<Konva.Stage>(null);

  useEffect(() => {
    let busy = false;
    let alive = true;
    const drain = async () => {
      if (busy) return;
      busy = true;
      try {
        for (;;) {
          const job = await invoke<RenderJob | null>("render_job_next");
          if (!job || !alive) break;
          if (job.kind === "prepare-video") {
            try {
              await invoke("render_job_done", { id: job.id, png: null, result: await prepareVideo(job), error: null });
            } catch (error) {
              await invoke("render_job_done", { id: job.id, png: null, result: null, error: String(error) }).catch(() => {});
            }
            continue;
          }
          try {
            const image = await decode(job.image_data_url);
            useEditorStore.getState().loadDoc(
              { image, width: job.width, height: job.height, origin: "project", captureId: null },
              job.doc,
              null,
            );
            const stage = await settled(() => stageRef.current);
            const png = flatten(stage);
            if (!png) throw new Error("The rendered image was empty.");
            await invoke("render_job_done", { id: job.id, png, result: null, error: null });
          } catch (error) {
            await invoke("render_job_done", { id: job.id, png: null, result: null, error: String(error) }).catch(() => {});
          } finally {
            useEditorStore.getState().reset();
          }
        }
      } finally {
        busy = false;
      }
    };
    void drain();
    const un = listen("render-job", () => void drain());
    return () => {
      alive = false;
      void un.then((f) => f());
    };
  }, []);

  return (
    <div className="editor-render-root" style={{ width: "100vw", height: "100vh", display: "flex" }}>
      <EditorStage ref={stageRef} />
    </div>
  );
}
