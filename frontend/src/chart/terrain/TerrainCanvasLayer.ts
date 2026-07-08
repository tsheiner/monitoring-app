import { rasterizeTerrain } from "./TerrainRasterizer";
import { DistributionDescriptor, TerrainSettings } from "./types";

interface TerrainCanvasInput {
  descriptors: DistributionDescriptor[];
  referenceSigma: number;
  timeRange: [number, number];
  yDomain: [number, number];
  settings: TerrainSettings;
}

export class TerrainCanvasLayer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private input: TerrainCanvasInput | null = null;
  private frameRequest: number | null = null;
  private visible = false;
  private lastRenderDurationMs = 0;
  private plotWidth = 0;
  private plotHeight = 0;
  private fullPixelRatio = 1;
  private previewMode = false;

  constructor(
    container: HTMLElement,
    margin: { top: number; right: number; bottom: number; left: number },
    width: number,
    height: number,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "terrain-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.position = "absolute";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "0";
    this.canvas.style.display = "none";
    container.insertBefore(this.canvas, container.firstChild);
    this.context = this.canvas.getContext("2d");
    this.resize(width, height, margin);
  }

  resize(
    width: number,
    height: number,
    margin: { top: number; right: number; bottom: number; left: number },
  ): void {
    this.plotWidth = Math.max(0, width - margin.left - margin.right);
    this.plotHeight = Math.max(0, height - margin.top - margin.bottom);
    this.fullPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.left = `${margin.left}px`;
    this.canvas.style.top = `${margin.top}px`;
    this.canvas.style.width = `${this.plotWidth}px`;
    this.canvas.style.height = `${this.plotHeight}px`;
    this.updateBackingSize();
    this.requestRender();
  }

  setPreviewMode(enabled: boolean): void {
    if (this.previewMode === enabled) return;
    this.previewMode = enabled;
  }

  isPreviewMode(): boolean {
    return this.previewMode;
  }

  private updateBackingSize(): void {
    // Keep one backing resolution for both settled and interactive renders.
    // Any resolution switch changes contour and shading appearance at the
    // exact moment the user needs a stable visual baseline for comparison.
    const ratio = this.fullPixelRatio;
    this.canvas.width = Math.max(1, Math.round(this.plotWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(this.plotHeight * ratio));
  }

  update(input: TerrainCanvasInput): void {
    this.input = input;
    this.requestRender();
  }

  show(): void {
    this.visible = true;
    this.canvas.style.display = "block";
    this.requestRender();
  }

  hide(): void {
    this.visible = false;
    this.canvas.style.display = "none";
  }

  isVisible(): boolean {
    return this.visible;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getLastRenderDurationMs(): number {
    return this.lastRenderDurationMs;
  }

  requestRender(): void {
    if (!this.visible || !this.input || this.frameRequest !== null) return;
    if (typeof window.requestAnimationFrame !== "function") {
      this.renderNow();
      return;
    }
    this.frameRequest = window.requestAnimationFrame(() => {
      this.frameRequest = null;
      this.renderNow();
    });
  }

  renderNow(): void {
    if (!this.visible || !this.input || !this.context) return;
    if (this.frameRequest !== null) {
      window.cancelAnimationFrame?.(this.frameRequest);
      this.frameRequest = null;
    }

    const start = performance.now();
    const result = rasterizeTerrain({
      width: this.canvas.width,
      height: this.canvas.height,
      timeRange: this.input.timeRange,
      yDomain: this.input.yDomain,
      descriptors: this.input.descriptors,
      referenceSigma: this.input.referenceSigma,
      settings: this.input.settings,
    });
    const imageData = this.context.createImageData(result.width, result.height);
    imageData.data.set(result.pixels);
    this.context.putImageData(imageData, 0, 0);
    this.lastRenderDurationMs = performance.now() - start;
    this.canvas.dataset.renderDurationMs = this.lastRenderDurationMs.toFixed(2);
  }

  destroy(): void {
    if (this.frameRequest !== null) {
      window.cancelAnimationFrame?.(this.frameRequest);
      this.frameRequest = null;
    }
    this.canvas.remove();
    this.input = null;
  }
}
