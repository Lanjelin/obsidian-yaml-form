export type FieldBase = {
  label?: string;
  path: string;              // dot-path under modelRoot (or absolute when modelRoot is "")
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
  required?: boolean;

  // Conditional visibility: evaluate against staged model
  visibleIf?: {
    path: string;            // relative to modelRoot for scalars, or item-local for repeater items
    equals?: any;
    contains?: string;       // substring match (string values)
    notEquals?: any;
    isTruthy?: boolean;
    isFalsy?: boolean;
  };
};

export type RepeaterField = FieldBase & {
  type: "repeater";
  itemSchema: FieldBase[];
};

export type UISchemaField = FieldBase | RepeaterField;

export interface UISchema {
  modelRoot?: string;        // "" means top-level frontmatter
  autosave?: boolean;
  fields: UISchemaField[];
}

export interface YAMLFormSettings {
  defaultAutosave: boolean;
  gridTemplate: string;      // e.g., "200px 1fr"
}

