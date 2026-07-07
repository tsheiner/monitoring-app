import { normalizeTerrainSettings } from "./defaults";
import { TerrainSettings } from "./types";

type TerrainSettingKey = keyof TerrainSettings;

const CONTROL_DEFINITIONS: Array<{
  key: TerrainSettingKey;
  label: string;
}> = [
  { key: "ridgeDefinition", label: "Ridge definition" },
  { key: "timeVsShapeBias", label: "Time vs. shape" },
  { key: "contourDetail", label: "Contour detail" },
  { key: "relief", label: "Relief" },
  { key: "presence", label: "Presence" },
];

export class TerrainControls {
  private root: HTMLDivElement;
  private settings: TerrainSettings;
  private feedbackTimer: number | null = null;

  constructor(
    parent: HTMLElement,
    initialSettings: TerrainSettings,
    onChange: (settings: TerrainSettings) => void,
    onInteractionChange: (active: boolean) => void = () => undefined,
  ) {
    this.settings = normalizeTerrainSettings(initialSettings);
    this.root = document.createElement("div");
    this.root.className = "terrain-settings";
    this.root.hidden = true;

    for (const definition of CONTROL_DEFINITIONS) {
      const row = document.createElement("div");
      row.className = "terrain-setting";

      const heading = document.createElement("div");
      heading.className = "terrain-setting-heading";
      const label = document.createElement("label");
      const inputId = `terrain-${definition.key}`;
      label.htmlFor = inputId;
      label.textContent = definition.label;
      const value = document.createElement("output");
      value.htmlFor = inputId;
      value.dataset.terrainValue = definition.key;
      value.textContent = this.settings[definition.key].toFixed(2);
      heading.append(label, value);

      const input = document.createElement("input");
      input.id = inputId;
      input.type = "range";
      input.min = "0";
      input.max = "1";
      input.step = "0.01";
      input.value = this.settings[definition.key].toString();
      input.dataset.terrainSetting = definition.key;
      input.addEventListener("input", () => {
        onInteractionChange(true);
        this.settings = normalizeTerrainSettings({
          ...this.settings,
          [definition.key]: Number(input.value),
        });
        value.textContent = this.settings[definition.key].toFixed(2);
        onChange({ ...this.settings });
      });
      input.addEventListener("change", () => {
        onInteractionChange(false);
        onChange({ ...this.settings });
      });

      row.append(heading, input);
      this.root.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "terrain-settings-actions";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "terrain-copy-settings";
    copyButton.textContent = "Copy settings";
    copyButton.addEventListener("click", () => this.copySettings());
    const feedback = document.createElement("span");
    feedback.className = "terrain-copy-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    actions.append(copyButton, feedback);
    this.root.appendChild(actions);

    const manualCopy = document.createElement("textarea");
    manualCopy.className = "terrain-manual-copy";
    manualCopy.readOnly = true;
    manualCopy.hidden = true;
    manualCopy.setAttribute("aria-label", "Terrain settings JSON");
    this.root.appendChild(manualCopy);

    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  getSettings(): TerrainSettings {
    return { ...this.settings };
  }

  private async copySettings(): Promise<void> {
    const feedback = this.root.querySelector<HTMLElement>(
      ".terrain-copy-feedback",
    );
    const text = JSON.stringify(this.settings, null, 2);
    const manualCopy = this.root.querySelector<HTMLTextAreaElement>(
      ".terrain-manual-copy",
    );
    try {
      await this.writeClipboard(text);
      if (feedback) feedback.textContent = "Copied";
      if (manualCopy) manualCopy.hidden = true;
    } catch {
      if (manualCopy) {
        manualCopy.value = text;
        manualCopy.hidden = false;
        manualCopy.focus();
        manualCopy.select();
      }
      if (feedback) feedback.textContent = "Press Ctrl/Cmd+C";
    }

    if (this.feedbackTimer !== null) {
      window.clearTimeout(this.feedbackTimer);
    }
    this.feedbackTimer = window.setTimeout(() => {
      if (feedback) feedback.textContent = "";
      this.feedbackTimer = null;
    }, 2400);
  }

  private async writeClipboard(text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // Fall through to the selection-based copy path used by restricted browsers.
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand?.("copy") ?? false;
    textarea.remove();
    if (!copied) throw new Error("Clipboard access unavailable");
  }

  destroy(): void {
    if (this.feedbackTimer !== null) {
      window.clearTimeout(this.feedbackTimer);
    }
    this.root.remove();
  }
}
