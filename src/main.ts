import { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

type UISchemaField =
  | ({
      label?: string;
      path: string;              // dot-path under modelRoot (or absolute when modelRoot "")
      type?:
        | "text" | "number" | "date" | "time" | "datetime-local"
        | "checkbox" | "select" | "textarea"
        | "csv-number" | "csv-text"
        | "repeater";
      placeholder?: string;
      min?: number;
      max?: number;
      step?: number;
      rows?: number;
      options?: string[];
    } & Record<string, any>)
  | ({
      type: "repeater";
      label?: string;
      path: string;              // array path
      itemSchema: Array<Omit<UISchemaField, "repeater" | "itemSchema">>;
    });

interface UISchema {
  modelRoot?: string; // "" means top-level frontmatter
  autosave?: boolean;
  fields: UISchemaField[];
}

export default class YAMLFormPlugin extends Plugin {
  async onload() {
    this.registerMarkdownCodeBlockProcessor("yaml-form", async (src, el, ctx) => {
      try {
        await this.renderForm(el, ctx);
      } catch (e) {
        const pre = el.createEl("pre");
        pre.setText("YAML Form: " + (e instanceof Error ? e.message : String(e)));
        console.error(e);
      }
    });
  }

  private getFrontmatter(ctx: MarkdownPostProcessorContext) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    // @ts-ignore private API but stable in practice
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter ?? {};
  }

  private getAtPath<T = any>(obj: any, path: string | undefined): T {
    if (!path) return obj;
    return path.split(".").reduce((o: any, k: string) => (o && typeof o === "object" ? o[k] : undefined), obj) as T;
  }

  private setAtPath(obj: any, path: string, value: any) {
    if (!path) return value;
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

  private joinPath(root: string, sub: string) {
    if (!root) return sub || "";
    if (!sub) return root;
    return `${root}.${sub}`;
  }

  private parseCsvNumbers(s: string) {
    if (!s) return [];
    return s.split(",").map(x => x.trim()).filter(Boolean)
      .map(Number).filter(n => Number.isFinite(n));
  }
  private toCsvNumbers(arr: unknown) {
    return Array.isArray(arr) ? (arr as any[]).join(", ") : "";
  }
  private parseCsvText(s: string) {
    if (!s) return [];
    return s.split(",").map(x => x.trim()).filter(Boolean);
  }
  private toCsvText(arr: unknown) {
    return Array.isArray(arr) ? (arr as any[]).join(", ") : "";
  }
  private coerceScalar(type: string, raw: string | boolean) {
    if (type === "number") {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    if (type === "checkbox") return !!raw;
    if (["date","time","datetime-local"].includes(type)) return raw || null;
    return raw ?? null;
  }

  private async renderForm(rootEl: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const fm = this.getFrontmatter(ctx);
    const ui: UISchema = this.getAtPath(fm, "form") ?? { fields: [] };
    const modelRoot = String(ui.modelRoot ?? "").trim();
    const autosave = !!ui.autosave;
    const fields = Array.isArray(ui.fields) ? ui.fields : [];

    // staged model = deep clone of bound model segment (so we don't mutate cache directly)
    const initialModel = JSON.parse(JSON.stringify(this.getAtPath(fm, modelRoot) ?? {}));
    let stagedModel: any = initialModel;

    // containers
    const wrap = rootEl.createEl("div", { cls: "yaml-form" });
    const grid = wrap.createEl("div", { cls: "yaml-form-grid" });

    // save bar
    const bar = wrap.createEl("div", { cls: "yaml-form-bar" });
    const status = bar.createEl("span", { cls: "yaml-form-status" });
    status.setText("Ready");
    const saveBtn = bar.createEl("button", { cls: "yaml-form-save" });
    saveBtn.setText("Save");
    saveBtn.disabled = true;

    const markDirty = () => { saveBtn.disabled = false; status.setText("Unsaved changes"); };

    const doSave = async () => {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      await this.app.fileManager.processFrontMatter(file, (fmOut: any) => {
        if (!modelRoot) {
          // top-level merge
          Object.entries(stagedModel).forEach(([k, v]) => ((fmOut as any)[k] = v));
        } else {
          const rootObj = this.getAtPath(fmOut, modelRoot) ?? {};
          const merged = Object.assign({}, rootObj, stagedModel);
          this.setAtPath(fmOut, modelRoot, merged);
        }
      });
      saveBtn.disabled = true;
      status.setText("Saved ✓");
    };
    saveBtn.addEventListener("click", () => void doSave());

    // helpers for rows
    const addRow = (label: string, control: HTMLElement) => {
      const lab = grid.createEl("label", { cls: "yaml-form-label" });
      lab.setText(label);
      const holder = grid.createEl("div");
      holder.appendChild(control);
    };

    // scalar renderer
    const renderScalar = (label: string, bindPath: string, type = "text", attrs: any = {}) => {
      const current = this.getAtPath(stagedModel, bindPath);
      let input: HTMLElement;

      if (type === "textarea") {
        const ta = document.createElement("textarea");
        if (attrs.rows) ta.rows = Number(attrs.rows);
        ta.placeholder = attrs.placeholder ?? "";
        ta.value = current ?? "";
        ta.addEventListener("input", () => {
          stagedModel = this.setAtPath(stagedModel, bindPath, (ta as HTMLTextAreaElement).value);
          autosave ? void doSave() : markDirty();
        });
        input = ta;
      } else if (type === "select") {
        const sel = document.createElement("select");
        (attrs.options ?? []).forEach((opt: string) => {
          const o = document.createElement("option");
          o.value = String(opt);
          o.textContent = String(opt);
          if (String(opt) === String(current)) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("input", () => {
          stagedModel = this.setAtPath(stagedModel, bindPath, (sel as HTMLSelectElement).value);
          autosave ? void doSave() : markDirty();
        });
        input = sel;
      } else if (type === "checkbox") {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!current;
        cb.addEventListener("input", () => {
          stagedModel = this.setAtPath(stagedModel, bindPath, cb.checked);
          autosave ? void doSave() : markDirty();
        });
        input = cb;
      } else if (type === "csv-number") {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.placeholder = "e.g. 8,8,6,6";
        inp.value = this.toCsvNumbers(Array.isArray(current) ? current : []);
        inp.addEventListener("input", () => {
          stagedModel = this.setAtPath(stagedModel, bindPath, this.parseCsvNumbers(inp.value));
          autosave ? void doSave() : markDirty();
        });
        input = inp;
      } else if (type === "csv-text") {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.placeholder = "tag1, tag2";
        inp.value = this.toCsvText(Array.isArray(current) ? current : []);
        inp.addEventListener("input", () => {
          stagedModel = this.setAtPath(stagedModel, bindPath, this.parseCsvText(inp.value));
          autosave ? void doSave() : markDirty();
        });
        input = inp;
      } else {
        const inp = document.createElement("input");
        inp.type = type;
        if (attrs.min != null) inp.min = String(attrs.min);
        if (attrs.max != null) inp.max = String(attrs.max);
        if (attrs.step != null) inp.step = String(attrs.step);
        inp.placeholder = attrs.placeholder ?? "";
        inp.value = current ?? "";
        inp.addEventListener("input", () => {
          const v = this.coerceScalar(type, inp.value);
          stagedModel = this.setAtPath(stagedModel, bindPath, v);
          autosave ? void doSave() : markDirty();
        });
        input = inp;
      }

      addRow(label, input);
    };

    // repeater renderer
    const renderRepeater = (label: string, bindPath: string, itemSchema: any[]) => {
      let arr = this.getAtPath<any[]>(stagedModel, bindPath);
      if (!Array.isArray(arr)) { arr = []; stagedModel = this.setAtPath(stagedModel, bindPath, arr); }

      const holder = document.createElement("div");
      const head = document.createElement("div"); head.className = "yaml-repeater-head";
      const title = document.createElement("div"); title.className = "yaml-repeater-title"; title.textContent = label;
      const actions = document.createElement("div"); actions.className = "yaml-repeater-actions";
      const addBtn = document.createElement("button"); addBtn.className = "yaml-btn"; addBtn.type = "button"; addBtn.textContent = "Legg til";
      actions.appendChild(addBtn); head.appendChild(title); head.appendChild(actions);

      const list = document.createElement("div"); list.className = "yaml-repeater-list";

      const refresh = (silent = false) => {
        list.innerHTML = "";
        const a = this.getAtPath<any[]>(stagedModel, bindPath) ?? [];
        a.forEach((item, idx) => {
          const card = document.createElement("div"); card.className = "yaml-repeater-item";
          const barI = document.createElement("div"); barI.className = "yaml-repeater-item-bar";
          const tag = document.createElement("span"); tag.className = "yaml-repeater-item-tag"; tag.textContent = `#${idx+1}`;
          const ctr = document.createElement("div"); ctr.className = "yaml-repeater-item-controls";
          const up = document.createElement("button"); up.type = "button"; up.className = "yaml-btn"; up.textContent = "↑";
          const down = document.createElement("button"); down.type = "button"; down.className = "yaml-btn"; down.textContent = "↓";
          const del = document.createElement("button"); del.type = "button"; del.className = "yaml-btn"; del.textContent = "Slett";
          ctr.appendChild(up); ctr.appendChild(down); ctr.appendChild(del);
          barI.appendChild(tag); barI.appendChild(ctr);
          card.appendChild(barI);

          const gridR = document.createElement("div"); gridR.className = "yaml-repeater-grid";

          itemSchema.forEach(f => {
            const fLabel = f.label ?? f.path;
            const fType = f.type ?? "text";
            const cell = document.createElement("div"); cell.className = "yaml-cell";
            const l2 = document.createElement("label"); l2.className = "yaml-form-label"; l2.textContent = fLabel;
            const p = `${bindPath}.${idx}.${f.path}`;
            const cur = this.getAtPath(stagedModel, p);
            let input: HTMLElement;

            if (fType === "textarea") {
              const ta = document.createElement("textarea");
              if (f.rows) ta.rows = Number(f.rows);
              ta.placeholder = f.placeholder ?? "";
              ta.value = cur ?? "";
              ta.addEventListener("input", () => { stagedModel = this.setAtPath(stagedModel, p, ta.value); autosave ? void doSave() : markDirty(); });
              input = ta;
            } else if (fType === "checkbox") {
              const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!cur;
              cb.addEventListener("input", () => { stagedModel = this.setAtPath(stagedModel, p, cb.checked); autosave ? void doSave() : markDirty(); });
              input = cb;
            } else if (fType === "select") {
              const sel = document.createElement("select");
              (f.options ?? []).forEach((opt: string) => {
                const o = document.createElement("option"); o.value = String(opt); o.textContent = String(opt);
                if (String(opt) === String(cur)) o.selected = true;
                sel.appendChild(o);
              });
              sel.addEventListener("input", () => { stagedModel = this.setAtPath(stagedModel, p, sel.value); autosave ? void doSave() : markDirty(); });
              input = sel;
            } else if (fType === "number") {
              const inp = document.createElement("input"); inp.type = "number";
              if (f.min != null) inp.min = String(f.min);
              if (f.step != null) inp.step = String(f.step);
              inp.placeholder = f.placeholder ?? "";
              inp.value = (cur ?? "") === "" ? "" : String(cur);
              inp.addEventListener("input", () => {
                const n = Number(inp.value);
                stagedModel = this.setAtPath(stagedModel, p, Number.isFinite(n) ? n : null);
                autosave ? void doSave() : markDirty();
              });
              input = inp;
            } else if (fType === "csv-number") {
              const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "8,8,6,6";
              inp.value = this.toCsvNumbers(Array.isArray(cur) ? cur : []);
              inp.addEventListener("input", () => { stagedModel = this.setAtPath(stagedModel, p, this.parseCsvNumbers(inp.value)); autosave ? void doSave() : markDirty(); });
              input = inp;
            } else if (fType === "csv-text") {
              const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "a, b, c";
              inp.value = this.toCsvText(Array.isArray(cur) ? cur : []);
              inp.addEventListener("input", () => { stagedModel = this.setAtPath(stagedModel, p, this.parseCsvText(inp.value)); autosave ? void doSave() : markDirty(); });
              input = inp;
            } else {
              const inp = document.createElement("input");
              inp.type = ["date","time","datetime-local","text"].includes(fType) ? fType : "text";
              inp.placeholder = f.placeholder ?? "";
              inp.value = cur ?? "";
              inp.addEventListener("input", () => { stagedModel = this.setAtPath(stagedModel, p, inp.value); autosave ? void doSave() : markDirty(); });
              input = inp;
            }

            cell.appendChild(l2);
            cell.appendChild(input);
            gridR.appendChild(cell);
          });

          card.appendChild(gridR);

          // item controls
          up.addEventListener("click", () => {
            const a = this.getAtPath<any[]>(stagedModel, bindPath) ?? [];
            if (idx <= 0) return;
            [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]];
            stagedModel = this.setAtPath(stagedModel, bindPath, a);
            refresh();
          });
          down.addEventListener("click", () => {
            const a = this.getAtPath<any[]>(stagedModel, bindPath) ?? [];
            if (idx >= a.length - 1) return;
            [a[idx + 1], a[idx]] = [a[idx], a[idx + 1]];
            stagedModel = this.setAtPath(stagedModel, bindPath, a);
            refresh();
          });
          del.addEventListener("click", () => {
            const a = this.getAtPath<any[]>(stagedModel, bindPath) ?? [];
            a.splice(idx, 1);
            stagedModel = this.setAtPath(stagedModel, bindPath, a);
            refresh();
          });

          list.appendChild(card);
        });
        if (!silent) { autosave ? void doSave() : markDirty(); }
      };

      addBtn.addEventListener("click", () => {
        const blank: Record<string, any> = {};
        (itemSchema ?? []).forEach(f => {
          if (f.type === "checkbox") blank[f.path] = false;
          else if (f.type === "csv-number" || f.type === "csv-text") blank[f.path] = [];
          else blank[f.path] = "";
        });
        const a = this.getAtPath<any[]>(stagedModel, bindPath) ?? [];
        a.push(blank);
        stagedModel = this.setAtPath(stagedModel, bindPath, a);
        refresh();
      });

      addRow(label, holder);
      holder.appendChild(head);
      holder.appendChild(list);
      refresh(true); // initial render without dirty flag
    };

    // lay out fields
    (fields as UISchemaField[]).forEach((f) => {
      const label = (f as any).label ?? (f as any).path;
      const bindPath = this.joinPath(modelRoot, (f as any).path || "");
      if (f.type === "repeater") {
        const rep = f as Extract<UISchemaField, {type:"repeater"}>;
        renderRepeater(label, bindPath, rep.itemSchema || []);
      } else {
        renderScalar(label, bindPath, (f as any).type ?? "text", f);
      }
    });

    // mount
    rootEl.empty();
    rootEl.appendChild(wrap);
  }
}

