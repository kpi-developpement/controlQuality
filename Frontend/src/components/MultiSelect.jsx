import React from "react";
import Select from "react-select";

export default function MultiSelect({
  value,
  onChange,
  options,
  placeholder = "Sélectionner...",
  isMulti = true,
  isClearable = true,
  isDisabled = false,
}) {
  const safeOptions = Array.isArray(options) ? options : [];
  const safeValue = Array.isArray(value) ? value : value ? [value] : [];
  const selected = safeOptions.filter((o) => safeValue.includes(String(o.value)));

  return (
    <Select
      isMulti={isMulti}
      isClearable={isClearable}
      isDisabled={isDisabled}
      options={safeOptions}
      value={selected}
      placeholder={placeholder}
      closeMenuOnSelect={!isMulti}
      onChange={(vals) => {
        if (!vals || (Array.isArray(vals) && vals.length === 0)) { onChange([]); return; }
        const arr = Array.isArray(vals) ? vals : [vals];
        onChange(arr.map((v) => String(v.value)));
      }}
      styles={{
        control: (base, state) => ({
          ...base,
          minHeight: 40,
          borderRadius: 10,
          borderColor: state.isFocused ? "var(--primary)" : "var(--border-strong)",
          boxShadow: state.isFocused ? "var(--ring)" : "var(--shadow-xs)",
          transition: "border-color 200ms, box-shadow 200ms",
          background: "var(--panel)",
          fontSize: "0.875rem",
          "&:hover": { borderColor: state.isFocused ? "var(--primary)" : "rgba(59,111,245,0.35)" },
        }),
        valueContainer: (base) => ({
          ...base,
          flexWrap: "nowrap",
          overflow: "hidden",
          padding: "2px 8px",
        }),
        multiValue: (base) => ({
          ...base,
          maxWidth: 140,
          borderRadius: 999,
          background: "var(--primary-bg)",
          border: "1px solid var(--primary-border)",
        }),
        multiValueLabel: (base) => ({
          ...base,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 110,
          fontSize: "0.8rem",
          fontWeight: 650,
          color: "var(--primary)",
        }),
        multiValueRemove: (base) => ({
          ...base,
          color: "var(--primary)",
          borderRadius: 999,
          "&:hover": { background: "var(--danger-bg)", color: "var(--danger)" },
        }),
        placeholder: (base) => ({
          ...base,
          color: "var(--muted)",
          fontSize: "0.875rem",
        }),
        input: (base) => ({
          ...base,
          color: "var(--text)",
          fontSize: "0.875rem",
        }),
        singleValue: (base) => ({
          ...base,
          color: "var(--text)",
        }),
        indicatorsContainer: (base) => ({
          ...base,
          flexShrink: 0,
        }),
        indicatorSeparator: () => ({ display: "none" }),
        dropdownIndicator: (base) => ({
          ...base,
          padding: "0 8px",
          color: "var(--muted)",
        }),
        menu: (base) => ({
          ...base,
          zIndex: 50,
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--panel)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-lg)",
          animation: "popIn 200ms cubic-bezier(0.22,1,0.36,1)",
        }),
        menuList: (base) => ({
          ...base,
          padding: 4,
        }),
        option: (base, state) => ({
          ...base,
          fontSize: "0.875rem",
          fontWeight: state.isSelected ? 700 : 500,
          borderRadius: 8,
          padding: "8px 10px",
          background: state.isSelected ? "var(--primary-bg)" : state.isFocused ? "var(--chip)" : "transparent",
          color: state.isSelected ? "var(--primary)" : "var(--text)",
          cursor: "pointer",
          "&:active": { background: "var(--primary-bg)" },
        }),
      }}
    />
  );
}
