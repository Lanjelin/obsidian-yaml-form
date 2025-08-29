import { App, MarkdownPostProcessorContext } from "obsidian";
import { UISchema, UISchemaField, RepeaterField, YAMLFormSettings } from "./types";
import {
  deepClone, getAtPath, setAtPath, joinPath,
  parseCsvNumbers, toCsvNumbers, parseCsvText, toCsvText,
  coerceScalar, isVisible
} from "./utils";

export class YAMLFormRenderer {
  constructor(
    private app: App,
    private settings: YAMLFormSettings,
  ) {}

  private getFrontmatter(ctx: MarkdownPostProcessorContext) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    // @ts-ignore private API (stable in practice)
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter ?? {};
  }

  async render(rootEl: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const fm = this.getFrontmatter(ctx);
    const ui: UISchema = getAtPath(fm, "form") ?? { fields: [] };
    const modelRoot = String(ui.modelRoot ?? "").trim();
    const autosave = ui.autosave ?? this.settings.defaultAutosave;
    const fields = Array.isArray(ui.fields) ? ui.fields : [];

    // staged model: deep clone
    const initialModel = deepClone(getAtPath(fm, modelRoot) ?? {});
    let stagedModel: any = initialModel;

    // containers
    const wrap = rootEl.createEl("div", { cls: "yaml-form" });
    wrap.style.setProperty("--yaml-form-grid", this.settings.gridTemplate);
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
      // simple validation pass
      const invalids = this.collectInvalids(fields, modelRoot, stagedModel);
      this.applyValidationStyles(grid, invalids);

      if (invalids.length > 0 && !autosave) {
        status.setText(`Please fill required fields (${invalids.length})`);
        return;
      }

      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      await this.app.fileManager.processFrontMatter(file, (fmOut: any) => {
        if (!modelRoot) {
          Object.entries(stagedModel).forEach(([k,v]) => (fmOut as any)[k] = v);
        } else {
          const rootObj = getAtPath(fmOut, modelRoot) ?? {};
          const merged = Object.assign({}, rootObj, stagedModel);
          setAtPath(fmOut, modelRoot, merged);
        }
      });
      saveBtn.disabled = true;
      status.setText("Saved ✓");
    };
    saveBtn.addEventListener("click", () => void doSave());

    // --- helper: set/unset visual error on a field, with inline message
    function setFieldError(inputEl: HTMLElement, msg?: string) {
      const parent = inputEl.parentElement!;
      let hint = parent.querySelector<HTMLDivElement>(".yaml-error-msg");
      if (msg) {
        inputEl.classList.add("yaml-error");
        inputEl.setAttribute("aria-invalid", "true");
        inputEl.setAttribute("title", msg);
        if (!hint) {
          hint = document.createElement("div");
          hint.className = "yaml-error-msg";
          parent.appendChild(hint);
        }
        hint.textContent = msg;
      } else {
        inputEl.classList.remove("yaml-error");
        inputEl.removeAttribute("aria-invalid");
        inputEl.removeAttribute("title");
        if (hint) hint.remove();
      }
    }

    const addRow = (label: string, control: HTMLElement) => {
      const lab = grid.createEl("label", { cls: "yaml-form-label" });
      lab.setText(label);
      const holder = grid.createEl("div");
      holder.appendChild(control);
    };

    // scalar
    const renderScalar = (f: UISchemaField) => {
      const label = f.label ?? f.path;
      const bindPath = joinPath(modelRoot, f.path || "");
      const current = getAtPath(stagedModel, bindPath);
      if (!isVisible(f.visibleIf, stagedModel)) return; // skip if hidden

      let input: HTMLElement;
      if (f.type === "textarea") {
        const ta = document.createElement("textarea");
        if (f.rows) ta.rows = Number(f.rows);
        ta.placeholder = f.placeholder ?? "";
        ta.value = current ?? "";
        ta.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, bindPath, ta.value); autosave ? void doSave() : markDirty(); });
        input = ta;
      } else if (f.type === "select") {
        const sel = document.createElement("select");
        (f.options ?? []).forEach(opt => {
          const o = document.createElement("option");
          o.value = String(opt); o.textContent = String(opt);
          if (String(opt) === String(current)) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, bindPath, sel.value); autosave ? void doSave() : markDirty(); });
        input = sel;
      } else if (f.type === "checkbox") {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!current;
        cb.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, bindPath, cb.checked); autosave ? void doSave() : markDirty(); });
        input = cb;
      } else if (f.type === "csv-number") {
        const inp = document.createElement("input");
        inp.type = "text"; inp.placeholder = "8,8,6,6";
        inp.value = toCsvNumbers(Array.isArray(current) ? current : []);
        inp.addEventListener("input", () => {
          const { values, invalid } = parseCsvNumbers(inp.value);
          stagedModel = setAtPath(stagedModel, bindPath, values);
          if (invalid.length > 0) {
            setFieldError(inp, `Invalid numbers: ${invalid.join(", ")}`);
            status.textContent = "Fix errors before saving";
          } else {
            setFieldError(inp, undefined);
            status.textContent = "Unsaved changes";
          }
          autosave ? void doSave() : markDirty();
        });
        input = inp;
      } else if (f.type === "csv-text") {
        const inp = document.createElement("input");
        inp.type = "text"; inp.placeholder = "a, b, c";
        inp.value = toCsvText(Array.isArray(current) ? current : []);
        inp.addEventListener("input", () => {
          const arr = parseCsvText(inp.value);
          stagedModel = setAtPath(stagedModel, bindPath, arr);
          // csv-text stays lenient
          autosave ? void doSave() : markDirty();
        });
        input = inp;
      } else {
        const inp = document.createElement("input");
        inp.type = (f.type && ["date","time","datetime-local","number","text"].includes(f.type)) ? f.type : "text";
        if (f.min != null) inp.min = String(f.min);
        if (f.max != null) inp.max = String(f.max);
        if (f.step != null) inp.step = String(f.step);
        inp.placeholder = f.placeholder ?? "";
        inp.value = current ?? "";
        inp.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, bindPath, coerceScalar(f.type ?? "text", inp.value)); autosave ? void doSave() : markDirty(); });
        input = inp;
      }
      addRow(label, input);
    };

    // repeater
    const renderRepeater = (rf: RepeaterField) => {
      const label = rf.label ?? rf.path;
      const bindPath = joinPath(modelRoot, rf.path || "");
      if (!isVisible(rf.visibleIf, stagedModel)) return;

      let a = getAtPath<any[]>(stagedModel, bindPath);
      if (!Array.isArray(a)) { a = []; stagedModel = setAtPath(stagedModel, bindPath, a); }

      // Holder for the right-side control column (give it a class for styling)
      const holder = document.createElement("div");
      holder.className = "yaml-repeater";

      // Header: keep only the actions (Add button), no duplicate title
      const head = document.createElement("div"); head.className = "yaml-repeater-head";
      const actions = document.createElement("div"); actions.className = "yaml-repeater-actions";
      const addBtn = document.createElement("button"); addBtn.className = "yaml-btn"; addBtn.type = "button"; addBtn.textContent = "Add";
      actions.appendChild(addBtn);
      head.appendChild(actions);

      const list = document.createElement("div"); list.className = "yaml-repeater-list";

      const refresh = (silent = false) => {
        list.innerHTML = "";
        const arr = getAtPath<any[]>(stagedModel, bindPath) ?? [];
        arr.forEach((item, idx) => {
          const card = document.createElement("div"); card.className = "yaml-repeater-item";
          const barI = document.createElement("div"); barI.className = "yaml-repeater-item-bar";
          const tag = document.createElement("span"); tag.className = "yaml-repeater-item-tag"; tag.textContent = `#${idx+1}`;
          const ctr = document.createElement("div"); ctr.className = "yaml-repeater-item-controls";
          const up = document.createElement("button"); up.type = "button"; up.className = "yaml-btn"; up.textContent = "↑";
          const down = document.createElement("button"); down.type = "button"; down.className = "yaml-btn"; down.textContent = "↓";
          const del = document.createElement("button"); del.type = "button"; del.className = "yaml-btn"; del.textContent = "Remove";
          ctr.appendChild(up); ctr.appendChild(down); ctr.appendChild(del);
          barI.appendChild(tag); barI.appendChild(ctr);
          card.appendChild(barI);

          const gridR = document.createElement("div"); gridR.className = "yaml-repeater-grid";

          rf.itemSchema.forEach(sf => {
            if (!isVisible(sf.visibleIf, stagedModel, `${bindPath}.${idx}`)) return;

            const fLabel = sf.label ?? sf.path;
            const cell = document.createElement("div"); cell.className = "yaml-cell";
            const l2 = document.createElement("label"); l2.className = "yaml-form-label"; l2.textContent = fLabel;
            const p = `${bindPath}.${idx}.${sf.path}`;
            const cur = getAtPath(stagedModel, p);

            let input: HTMLElement;
            if (sf.type === "textarea") {
              const ta = document.createElement("textarea");
              if (sf.rows) ta.rows = Number(sf.rows);
              ta.placeholder = sf.placeholder ?? "";
              ta.value = cur ?? "";
              ta.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, p, ta.value); autosave ? void doSave() : markDirty(); });
              input = ta;
            } else if (sf.type === "checkbox") {
              const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!cur;
              cb.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, p, cb.checked); autosave ? void doSave() : markDirty(); });
              input = cb;
            } else if (sf.type === "select") {
              const sel = document.createElement("select");
              (sf.options ?? []).forEach(opt => {
                const o = document.createElement("option"); o.value = String(opt); o.textContent = String(opt);
                if (String(opt) === String(cur)) o.selected = true;
                sel.appendChild(o);
              });
              sel.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, p, sel.value); autosave ? void doSave() : markDirty(); });
              input = sel;
            } else if (sf.type === "number") {
              const inp = document.createElement("input"); inp.type = "number";
              if (sf.min != null) inp.min = String(sf.min);
              if (sf.step != null) inp.step = String(sf.step);
              inp.placeholder = sf.placeholder ?? "";
              inp.value = (cur ?? "") === "" ? "" : String(cur);
              inp.addEventListener("input", () => {
                const n = Number(inp.value);
                stagedModel = setAtPath(stagedModel, p, Number.isFinite(n) ? n : null);
                autosave ? void doSave() : markDirty();
              });
              input = inp;
            } else if (sf.type === "csv-number") {
              const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "8,8,6,6";
              inp.value = toCsvNumbers(Array.isArray(cur) ? cur : []);
              inp.addEventListener("input", () => {
                const { values, invalid } = parseCsvNumbers(inp.value);
                stagedModel = setAtPath(stagedModel, p, values);
                if (invalid.length > 0) {
                  setFieldError(inp, `Invalid numbers: ${invalid.join(", ")}`);
                  status.textContent = "Fix errors before saving";
                } else {
                  setFieldError(inp, undefined);
                  status.textContent = "Unsaved changes";
                }
                autosave ? void doSave() : markDirty();
              });
              input = inp;
            } else if (sf.type === "csv-text") {
              const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "a, b, c";
              inp.value = toCsvText(Array.isArray(cur) ? cur : []);
              inp.addEventListener("input", () => {
                const arr = parseCsvText(inp.value);
                stagedModel = setAtPath(stagedModel, p, arr);
                autosave ? void doSave() : markDirty();
              });
              input = inp;
            } else {
              const inp = document.createElement("input");
              inp.type = (sf.type && ["date","time","datetime-local","number","text"].includes(sf.type)) ? sf.type : "text";
              inp.placeholder = sf.placeholder ?? "";
              inp.value = cur ?? "";
              inp.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, p, inp.value); autosave ? void doSave() : markDirty(); });
              input = inp;
            }

            cell.appendChild(l2);
            cell.appendChild(input);
            gridR.appendChild(cell);
          });

          card.appendChild(gridR);

          up.addEventListener("click", () => {
            const a2 = getAtPath<any[]>(stagedModel, bindPath) ?? [];
            if (idx <= 0) return;
            [a2[idx-1], a2[idx]] = [a2[idx], a2[idx-1]];
            stagedModel = setAtPath(stagedModel, bindPath, a2);
            refresh();
          });
          down.addEventListener("click", () => {
            const a2 = getAtPath<any[]>(stagedModel, bindPath) ?? [];
            if (idx >= a2.length - 1) return;
            [a2[idx+1], a2[idx]] = [a2[idx], a2[idx+1]];
            stagedModel = setAtPath(stagedModel, bindPath, a2);
            refresh();
          });
          del.addEventListener("click", () => {
            const a2 = getAtPath<any[]>(stagedModel, bindPath) ?? [];
            a2.splice(idx, 1);
            stagedModel = setAtPath(stagedModel, bindPath, a2);
            refresh();
          });

          list.appendChild(card);
        });
        if (!silent) { autosave ? void doSave() : markDirty(); }
      };

      // Add row with left label + right-side holder
      addRow(label, holder);
      holder.appendChild(head);
      holder.appendChild(list);

      // Add button handler
      addBtn.addEventListener("click", () => {
        const blank: Record<string, any> = {};
        (rf.itemSchema ?? []).forEach(sf => {
          if (sf.type === "checkbox") blank[sf.path] = false;
          else if (sf.type === "csv-number" || sf.type === "csv-text") blank[sf.path] = [];
          else blank[sf.path] = "";
        });
        const arr = getAtPath<any[]>(stagedModel, bindPath) ?? [];
        arr.push(blank);
        stagedModel = setAtPath(stagedModel, bindPath, arr);
        refresh();
      });

      refresh(true);
    };

    // lay out fields
    fields.forEach((f: UISchemaField) => {
      if (f.type === "repeater") renderRepeater(f as any);
      else renderScalar(f);
    });

    // mount
    rootEl.empty();
    rootEl.appendChild(wrap);

    // tiny API (optional)
    // @ts-ignore
    (wrap as any).__yamlForm = { save: doSave, markDirty, getModel: () => deepClone(stagedModel) };
  }

  private collectInvalids(fields: UISchemaField[], modelRoot: string, stagedModel: any): string[] {
    const invalid: string[] = [];

    const checkField = (f: UISchemaField, bindPath: string) => {
      if (!(f as any).required) return;
      if (!isVisible((f as any).visibleIf, stagedModel)) return;
      const v = getAtPath(stagedModel, bindPath);
      const empty = v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
      if (empty) invalid.push(bindPath);
    };

    fields.forEach(f => {
      const bindPath = joinPath(modelRoot, (f as any).path);
      if (f.type === "repeater") {
        const arr = getAtPath<any[]>(stagedModel, bindPath) ?? [];
        arr.forEach((_, i) => {
          ((f as RepeaterField).itemSchema || []).forEach(sf => {
            const p = `${bindPath}.${i}.${sf.path}`;
            if (!isVisible(sf.visibleIf, stagedModel, `${bindPath}.${i}`)) return;
            if (sf.required) {
              const v = getAtPath(stagedModel, p);
              const empty = v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
              if (empty) invalid.push(p);
            }
          });
        });
      } else {
        checkField(f, bindPath);
      }
    });

    return invalid;
  }

  private applyValidationStyles(_grid: HTMLElement, _invalidPaths: string[]) {
    // Placeholder: could map bind paths to data attributes and toggle .yaml-error.
  }
}

