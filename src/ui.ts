import { App, MarkdownPostProcessorContext } from "obsidian";
import { UISchema, UISchemaField, RepeaterField, YAMLFormSettings } from "./types";
import {
  deepClone, getAtPath, setAtPath, joinPath,
  parseCsvNumbers, toCsvNumbers, parseCsvText, toCsvText,
  coerceScalar, isVisible
} from "./utils";

type VisibilityNode = {
  // For top-level scalar: hide/show BOTH the label and the holder (form row)
  labelEl?: HTMLElement;      // present for top-level rows
  holderEl: HTMLElement;      // the container that holds the input(s)
  field: UISchemaField;
  bindPath: string;           // absolute path inside stagedModel
  itemBase?: string;          // for repeater items, base path like "<bindPath>.<idx>"
};

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

    // --- visibility registry for reactive visibleIf
    const visNodes: VisibilityNode[] = [];
    const updateVisibility = () => {
      for (const node of visNodes) {
        const visible = isVisible(
          (node.field as any).visibleIf,
          stagedModel,
          node.itemBase
        );
        // For top-level rows: hide both label and holder to keep grid aligned
        if (node.labelEl) node.labelEl.style.display = visible ? "" : "none";
        node.holderEl.style.display = visible ? "" : "none";
      }
    };

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

    // add a row; returns both elements so we can toggle them for visibility
    const addRow = (label: string) => {
      const labelEl = grid.createEl("label", { cls: "yaml-form-label" });
      labelEl.setText(label);
      const holderEl = grid.createEl("div");
      return { labelEl, holderEl };
    };

    // scalar
    const renderScalar = (f: UISchemaField) => {
      const label = f.label ?? f.path;
      const bindPath = joinPath(modelRoot, f.path || "");
      const current = getAtPath(stagedModel, bindPath);

      const { labelEl, holderEl } = addRow(label);

      // record this node for reactive visibility (even if no visibleIf; cheap)
      visNodes.push({ labelEl, holderEl, field: f, bindPath });

      // skip building input if invisible right now? We still build it so when it becomes visible it's ready.
      let input: HTMLElement;
      const triggerPostChange = () => { autosave ? void doSave() : markDirty(); updateVisibility(); };

      if (f.type === "textarea") {
        const ta = document.createElement("textarea");
        if (f.rows) ta.rows = Number(f.rows);
        ta.placeholder = f.placeholder ?? "";
        ta.value = current ?? "";
        ta.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, bindPath, ta.value); triggerPostChange(); });
        input = ta;
      } else if (f.type === "select") {
        const sel = document.createElement("select");
        (f.options ?? []).forEach(opt => {
          const o = document.createElement("option");
          o.value = String(opt); o.textContent = String(opt);
          if (String(opt) === String(current)) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, bindPath, sel.value); triggerPostChange(); });
        input = sel;
      } else if (f.type === "checkbox") {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!current;
        cb.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, bindPath, cb.checked); triggerPostChange(); });
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
          triggerPostChange();
        });
        input = inp;
      } else if (f.type === "csv-text") {
        const inp = document.createElement("input");
        inp.type = "text"; inp.placeholder = "a, b, c";
        inp.value = toCsvText(Array.isArray(current) ? current : []);
        inp.addEventListener("input", () => {
          const arr = parseCsvText(inp.value);
          stagedModel = setAtPath(stagedModel, bindPath, arr);
          triggerPostChange();
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
        inp.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, bindPath, coerceScalar(f.type ?? "text", inp.value)); triggerPostChange(); });
        input = inp;
      }

      holderEl.appendChild(input);
    };

    // repeater
    const renderRepeater = (rf: RepeaterField) => {
      const label = rf.label ?? rf.path;
      const bindPath = joinPath(modelRoot, rf.path || "");

      // row: label on left, holder on right (and register for visibility)
      const { labelEl, holderEl } = addRow(label);
      visNodes.push({ labelEl, holderEl, field: rf, bindPath });

      let arr = getAtPath<any[]>(stagedModel, bindPath);
      if (!Array.isArray(arr)) { arr = []; stagedModel = setAtPath(stagedModel, bindPath, arr); }

      // Holder content
      const head = document.createElement("div"); head.className = "yaml-repeater-head";
      const actions = document.createElement("div"); actions.className = "yaml-repeater-actions";
      const addBtn = document.createElement("button"); addBtn.className = "yaml-btn"; addBtn.type = "button"; addBtn.textContent = "Add";
      actions.appendChild(addBtn);
      head.appendChild(actions);

      const list = document.createElement("div"); list.className = "yaml-repeater-list";

      const refresh = (silent = false) => {
        list.innerHTML = "";
        const a = getAtPath<any[]>(stagedModel, bindPath) ?? [];
        a.forEach((item, idx) => {
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
            const cell = document.createElement("div"); cell.className = "yaml-cell";
            const fLabel = sf.label ?? sf.path;
            const l2 = document.createElement("label"); l2.className = "yaml-form-label"; l2.textContent = fLabel;
            const p = `${bindPath}.${idx}.${sf.path}`;
            const cur = getAtPath(stagedModel, p);

            let input: HTMLElement;
            const triggerPostChange = () => { autosave ? void doSave() : markDirty(); updateVisibility(); };

            if (sf.type === "textarea") {
              const ta = document.createElement("textarea");
              if (sf.rows) ta.rows = Number(sf.rows);
              ta.placeholder = sf.placeholder ?? "";
              ta.value = cur ?? "";
              ta.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, p, ta.value); triggerPostChange(); });
              input = ta;
            } else if (sf.type === "checkbox") {
              const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!cur;
              cb.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, p, cb.checked); triggerPostChange(); });
              input = cb;
            } else if (sf.type === "select") {
              const sel = document.createElement("select");
              (sf.options ?? []).forEach(opt => {
                const o = document.createElement("option"); o.value = String(opt); o.textContent = String(opt);
                if (String(opt) === String(cur)) o.selected = true;
                sel.appendChild(o);
              });
              sel.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, p, sel.value); triggerPostChange(); });
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
                triggerPostChange();
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
                triggerPostChange();
              });
              input = inp;
            } else if (sf.type === "csv-text") {
              const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "a, b, c";
              inp.value = toCsvText(Array.isArray(cur) ? cur : []);
              inp.addEventListener("input", () => {
                const arr = parseCsvText(inp.value);
                stagedModel = setAtPath(stagedModel, p, arr);
                triggerPostChange();
              });
              input = inp;
            } else {
              const inp = document.createElement("input");
              inp.type = (sf.type && ["date","time","datetime-local","number","text"].includes(sf.type)) ? sf.type : "text";
              inp.placeholder = sf.placeholder ?? "";
              inp.value = cur ?? "";
              inp.addEventListener("input", () => { stagedModel = setAtPath(stagedModel, p, inp.value); triggerPostChange(); });
              input = inp;
            }

            cell.appendChild(l2);
            cell.appendChild(input);
            gridR.appendChild(cell);

            // register each repeater subfield for reactive visibility (toggle the cell)
            visNodes.push({
              holderEl: cell,            // hide/show this cell
              field: sf,
              bindPath: p,               // absolute path
              itemBase: `${bindPath}.${idx}` // base for visibleIf path resolution
            });
          });

          card.appendChild(gridR);

          up.addEventListener("click", () => {
            const a2 = getAtPath<any[]>(stagedModel, bindPath) ?? [];
            if (idx <= 0) return;
            [a2[idx-1], a2[idx]] = [a2[idx], a2[idx-1]];
            stagedModel = setAtPath(stagedModel, bindPath, a2);
            refresh();
            updateVisibility();
          });
          down.addEventListener("click", () => {
            const a2 = getAtPath<any[]>(stagedModel, bindPath) ?? [];
            if (idx >= a2.length - 1) return;
            [a2[idx+1], a2[idx]] = [a2[idx], a2[idx+1]];
            stagedModel = setAtPath(stagedModel, bindPath, a2);
            refresh();
            updateVisibility();
          });
          del.addEventListener("click", () => {
            const a2 = getAtPath<any[]>(stagedModel, bindPath) ?? [];
            a2.splice(idx, 1);
            stagedModel = setAtPath(stagedModel, bindPath, a2);
            refresh();
            updateVisibility();
          });

          list.appendChild(card);
        });

        if (!silent) { autosave ? void doSave() : markDirty(); }
      };

      holderEl.appendChild(head);
      holderEl.appendChild(list);

      addBtn.addEventListener("click", () => {
        const blank: Record<string, any> = {};
        (rf.itemSchema ?? []).forEach(sf => {
          if (sf.type === "checkbox") blank[sf.path] = false;
          else if (sf.type === "csv-number" || sf.type === "csv-text") blank[sf.path] = [];
          else blank[sf.path] = "";
        });
        const a = getAtPath<any[]>(stagedModel, bindPath) ?? [];
        a.push(blank);
        stagedModel = setAtPath(stagedModel, bindPath, a);
        refresh();
        updateVisibility();
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

    // initial visibility pass
    updateVisibility();

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
    // Placeholder for future: map data-paths to inputs and toggle .yaml-error.
  }
}

