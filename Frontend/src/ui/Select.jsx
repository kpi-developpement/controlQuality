import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown, FiCheck, FiSearch } from "react-icons/fi";

/**
 * Remplaçant stylé de <select> : mêmes props (value, onChange(e), children <option>/<optgroup>,
 * className, style, disabled, multiple, name). onChange reçoit un pseudo-évènement
 * { target: { value, name, options } } compatible avec le code existant (e.target.value).
 */

function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf(node.props.children);
  return "";
}

function collect(children, group = null, out = []) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) { collect(child.props.children, group, out); return; }
    if (child.type === "optgroup") { collect(child.props.children, child.props.label, out); return; }
    if (child.type === "option") {
      const label = textOf(child.props.children);
      const value = child.props.value !== undefined ? String(child.props.value) : label;
      out.push({ value, label, disabled: !!child.props.disabled, group, hidden: !!child.props.hidden });
    }
  });
  return out;
}

const SEARCH_THRESHOLD = 8;

export default function Select({
  value, defaultValue, onChange, children, className = "", style, disabled, multiple, name, id,
  title, required, placeholder, "aria-label": ariaLabel, ...rest
}) {
  const options = useMemo(() => collect(children), [children]);
  const isControlled = value !== undefined;
  const [inner, setInner] = useState(() => (defaultValue !== undefined ? defaultValue : multiple ? [] : options[0]?.value ?? ""));
  const current = isControlled ? value : inner;
  const selectedSet = useMemo(() => {
    if (multiple) return new Set((Array.isArray(current) ? current : []).map(String));
    return new Set([current === null || current === undefined ? "" : String(current)]);
  }, [current, multiple]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const typeahead = useRef({ s: "", t: 0 });
  const listId = useId();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => !o.hidden && (!q || o.label.toLowerCase().includes(q)));
  }, [options, query]);

  const selectedOpt = !multiple ? options.find((o) => selectedSet.has(o.value)) : null;
  const display = multiple
    ? options.filter((o) => selectedSet.has(o.value)).map((o) => o.label).join(", ")
    : selectedOpt?.label ?? "";
  const isPlaceholder = multiple ? selectedSet.size === 0 : !selectedOpt || selectedOpt.value === "";

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const desired = Math.min(320, 44 + visible.length * 38 + (options.length > SEARCH_THRESHOLD ? 48 : 0));
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const up = below < Math.min(desired, 220) && above > below;
    const maxH = Math.max(140, Math.min(320, up ? above : below));
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 200) - 8)),
      width: Math.max(r.width, 200),
      top: up ? undefined : r.bottom + 6,
      bottom: up ? vh - r.top + 6 : undefined,
      maxH,
      up,
    });
  }, [visible.length, options.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = (e) => { if (menuRef.current?.contains(e.target)) return; place(); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    const idx = visible.findIndex((o) => selectedSet.has(o.value));
    setActive(idx >= 0 ? idx : 0);
    if (options.length > SEARCH_THRESHOLD) setTimeout(() => searchRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function emit(next) {
    if (!isControlled) setInner(next);
    if (!onChange) return;
    const values = multiple ? next : [next];
    const target = {
      value: multiple ? (next[0] ?? "") : next,
      name,
      id,
      multiple: !!multiple,
      options: options.map((o) => ({ value: o.value, text: o.label, selected: values.includes(o.value) })),
      selectedOptions: options.filter((o) => values.includes(o.value)).map((o) => ({ value: o.value, text: o.label })),
    };
    onChange({ target, currentTarget: target, preventDefault() {}, stopPropagation() {}, persist() {} });
  }

  function choose(opt) {
    if (!opt || opt.disabled) return;
    if (multiple) {
      const arr = Array.from(selectedSet);
      emit(arr.includes(opt.value) ? arr.filter((v) => v !== opt.value) : [...arr, opt.value]);
    } else {
      if (!selectedSet.has(opt.value)) emit(opt.value);
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function move(delta) {
    if (!visible.length) return;
    let i = active;
    for (let n = 0; n < visible.length; n++) {
      i = (i + delta + visible.length) % visible.length;
      if (!visible[i].disabled) break;
    }
    setActive(i);
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); setOpen(true); }
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        // Saisie rapide sans ouvrir (comme un select natif)
        const t = typeahead.current; const now = Date.now();
        t.s = now - t.t < 700 ? t.s + e.key.toLowerCase() : e.key.toLowerCase(); t.t = now;
        const hit = options.find((o) => !o.disabled && o.label.toLowerCase().startsWith(t.s));
        if (hit && !multiple) emit(hit.value);
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(visible.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(visible[active]); }
    else if (e.key === "Escape" || e.key === "Tab") { setOpen(false); }
  }

  let lastGroup = null;
  const menu = open && pos ? createPortal(
    <div
      ref={menuRef}
      className={`kselect__menu${pos.up ? " is-up" : ""}`}
      style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
      onKeyDown={onKeyDown}
    >
      {options.length > SEARCH_THRESHOLD && (
        <div className="kselect__search">
          <FiSearch className="ico" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder="Rechercher…"
            aria-label="Filtrer les options"
          />
        </div>
      )}
      <div className="kselect__list" role="listbox" id={listId} aria-multiselectable={multiple || undefined}>
        {visible.length === 0 && <div className="kselect__empty">Aucun résultat</div>}
        {visible.map((o, i) => {
          const header = o.group && o.group !== lastGroup ? <div key={`g-${o.group}-${i}`} className="kselect__group">{o.group}</div> : null;
          lastGroup = o.group;
          const sel = selectedSet.has(o.value);
          return (
            <React.Fragment key={`${o.value}-${i}`}>
              {header}
              <div
                role="option"
                aria-selected={sel}
                aria-disabled={o.disabled || undefined}
                data-idx={i}
                className={`kselect__opt${sel ? " is-selected" : ""}${i === active ? " is-active" : ""}${o.disabled ? " is-disabled" : ""}${o.value === "" ? " is-empty" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                {multiple && <span className={`kselect__box${sel ? " is-on" : ""}`}>{sel && <FiCheck />}</span>}
                <span className="kselect__label">{o.label || " "}</span>
                {!multiple && sel && <FiCheck className="kselect__tick" />}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>,
    document.body
  ) : null;

  const hasInputClass = /\binput\b/.test(className);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        title={title || (display.length > 28 ? display : undefined)}
        className={`kselect ${hasInputClass ? "" : "kselect--bare "}${className}${open ? " is-open" : ""}${isPlaceholder ? " is-placeholder" : ""}`}
        style={style}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        {...rest}
      >
        <span className="kselect__value">{display || placeholder || " "}</span>
        <FiChevronDown className="kselect__chev" />
      </button>
      {menu}
    </>
  );
}
