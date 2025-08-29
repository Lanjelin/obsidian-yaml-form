import { App, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext } from "obsidian";
import { YAMLFormRenderer } from "./ui";
import { YAMLFormSettings } from "./types";

const DEFAULTS: YAMLFormSettings = {
  defaultAutosave: false,
  gridTemplate: "200px 1fr"
};

export default class YAMLFormPlugin extends Plugin {
  settings: YAMLFormSettings = DEFAULTS;
  renderer!: YAMLFormRenderer;

  async onload() {
    await this.loadSettings();
    this.renderer = new YAMLFormRenderer(this.app, this.settings);

    this.registerMarkdownCodeBlockProcessor("yaml-form", async (_src: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      try {
        await this.renderer.render(el, ctx);
      } catch (e) {
        const pre = el.createEl("pre");
        pre.setText("YAML Form: " + (e instanceof Error ? e.message : String(e)));
        console.error(e);
      }
    });

    this.addSettingTab(new YAMLFormSettingsTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class YAMLFormSettingsTab extends PluginSettingTab {
  plugin: YAMLFormPlugin;

  constructor(app: App, plugin: YAMLFormPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "YAML Form – Settings" });

    new Setting(containerEl)
      .setName("Default autosave")
      .setDesc("Save changes automatically as you type (can be overridden per note via form.autosave).")
      .addToggle(t => t.setValue(this.plugin.settings.defaultAutosave).onChange(async (v) => {
        this.plugin.settings.defaultAutosave = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Grid template")
      .setDesc("CSS grid columns for the form (e.g., '220px 1fr').")
      .addText(t => t.setPlaceholder("200px 1fr").setValue(this.plugin.settings.gridTemplate).onChange(async (v) => {
        this.plugin.settings.gridTemplate = v || "200px 1fr";
        await this.plugin.saveSettings();
      }));
  }
}

