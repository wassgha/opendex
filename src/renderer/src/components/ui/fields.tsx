import { useState, type ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-white/80">{label}</span>
      {children}
      {hint && <span className="text-xs text-white/40">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition focus:border-white/40";

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows = 6,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={`${inputClass} resize-y font-mono leading-relaxed`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Secret field: never receives the stored value (only whether it is set). Lets
 * the user type a new value to save, or clear the existing one.
 */
export function SecretField({
  label,
  hint,
  present,
  onSave,
}: {
  label: string;
  hint?: ReactNode;
  present: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!present);

  if (present && !editing) {
    return (
      <Field label={label} hint={hint}>
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
            Saved
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-white/60 hover:text-white"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => onSave("")}
              className="text-xs text-rose-300/80 hover:text-rose-200"
            >
              Clear
            </button>
          </div>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          type="password"
          className={inputClass}
          value={value}
          placeholder="Paste key…"
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          disabled={!value.trim()}
          onClick={() => {
            onSave(value.trim());
            setValue("");
            setEditing(false);
          }}
          className="shrink-0 rounded-lg bg-white px-4 text-sm font-medium text-black transition enabled:hover:bg-white/90 disabled:opacity-30"
        >
          Save
        </button>
      </div>
    </Field>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm transition ${
            value === o.value
              ? "bg-white/15 text-white"
              : "text-white/50 hover:text-white/80"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
