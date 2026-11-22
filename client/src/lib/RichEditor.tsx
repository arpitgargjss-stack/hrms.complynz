import { useEffect, useRef, useState } from "react";
import { PLACEHOLDERS } from "../../../shared/hr/placeholders";
import { chipHtml, fromEditorHtml, splitHead, toEditorHtml } from "../../../shared/hr/policyEditor";

/**
 * A plain visual editor for policy text: headings, bold, italic, lists, links and tables, with "Insert field" adding
 * a placeholder as a chip (for example "Presiding officer") that is filled in from Configuration.
 * Built on contentEditable with no extra libraries; "View HTML" is there for anyone who needs the source.
 */
const labelOf = (k: string) => PLACEHOLDERS.find((p) => p.key === k)?.label ?? null;
const exec = (cmd: string, arg?: string) => document.execCommand(cmd, false, arg);

export function RichEditor({ value, onChange, disabled, label }: { value: string; onChange: (template: string) => void; disabled?: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [source, setSource] = useState(false);
  const [block, setBlock] = useState("p");
  const head = useRef("");

  // Load text from outside (opening a draft, discarding changes) without fighting the caret while typing.
  useEffect(() => {
    if (source || !ref.current || value === last.current) return;
    const parts = splitHead(value);
    head.current = parts.head; // the policy's own <style>/<title>, kept out of the editor and put back on save
    ref.current.innerHTML = toEditorHtml(parts.body, labelOf);
    last.current = value;
  }, [value, source]);

  const emit = () => { if (!ref.current) return; const t = head.current + fromEditorHtml(ref.current.innerHTML); last.current = t; onChange(t); };
  const keep = () => { const s = window.getSelection(); if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange(); };
  const restore = () => { ref.current?.focus(); const s = window.getSelection(); if (range.current && s) { s.removeAllRanges(); s.addRange(range.current); } };
  const run = (cmd: string, arg?: string) => { restore(); exec(cmd, arg); emit(); keep(); };
  const insertHtml = (html: string) => { restore(); exec("insertHTML", html); emit(); keep(); };
  const field = (key: string) => { const l = labelOf(key); if (l) insertHtml(`${chipHtml(key, l)}&nbsp;`); };
  const link = () => { const url = window.prompt("Link address (https://…)"); if (url && /^https?:\/\//i.test(url)) run("createLink", url); };
  const table = () => insertHtml("<table><thead><tr><th>Heading</th><th>Heading</th></tr></thead><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>");
  const syncBlock = () => { keep(); const b = String(document.queryCommandValue("formatBlock") || "p").toLowerCase().replace(/[<>]/g, ""); setBlock(["h1", "h2", "h3"].includes(b) ? b : "p"); };
  const groups = [...new Set(PLACEHOLDERS.map((p) => p.group))];

  return <div className={`rte${disabled ? " rte-off" : ""}`}>
    <div className="rte-bar" role="toolbar" aria-label={`${label} formatting`}>
      <select aria-label="Text style" disabled={disabled || source} value={block} onChange={(e) => { setBlock(e.target.value); run("formatBlock", e.target.value); }}>
        <option value="p">Paragraph</option><option value="h1">Title</option><option value="h2">Heading</option><option value="h3">Subheading</option>
      </select>
      <span className="rte-sep" />
      <button type="button" title="Bold" aria-label="Bold" disabled={disabled || source} onMouseDown={(e) => e.preventDefault()} onClick={() => run("bold")}><b>B</b></button>
      <button type="button" title="Italic" aria-label="Italic" disabled={disabled || source} onMouseDown={(e) => e.preventDefault()} onClick={() => run("italic")}><i>I</i></button>
      <button type="button" title="Bulleted list" aria-label="Bulleted list" disabled={disabled || source} onMouseDown={(e) => e.preventDefault()} onClick={() => run("insertUnorderedList")}>• List</button>
      <button type="button" title="Numbered list" aria-label="Numbered list" disabled={disabled || source} onMouseDown={(e) => e.preventDefault()} onClick={() => run("insertOrderedList")}>1. List</button>
      <button type="button" title="Link" aria-label="Insert link" disabled={disabled || source} onMouseDown={(e) => e.preventDefault()} onClick={link}>Link</button>
      <button type="button" title="Table" aria-label="Insert table" disabled={disabled || source} onMouseDown={(e) => e.preventDefault()} onClick={table}>Table</button>
      <span className="rte-sep" />
      <button type="button" title="Undo" aria-label="Undo" disabled={disabled || source} onMouseDown={(e) => e.preventDefault()} onClick={() => run("undo")}>↶</button>
      <button type="button" title="Redo" aria-label="Redo" disabled={disabled || source} onMouseDown={(e) => e.preventDefault()} onClick={() => run("redo")}>↷</button>
      <select className="rte-field" aria-label="Insert field" disabled={disabled || source} value="" onChange={(e) => e.target.value && field(e.target.value)}>
        <option value="">Insert field…</option>
        {groups.map((g) => <optgroup key={g} label={g}>{PLACEHOLDERS.filter((p) => p.group === g).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</optgroup>)}
      </select>
      <label className="rte-src"><input type="checkbox" checked={source} onChange={(e) => { if (!e.target.checked) last.current = null; setSource(e.target.checked); }} /> View HTML</label>
    </div>
    {source
      ? <textarea className="rte-html" aria-label={`${label} HTML`} spellCheck={false} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
      : <div ref={ref} className="rte-doc" role="textbox" aria-multiline="true" aria-label={label} contentEditable={!disabled} suppressContentEditableWarning
          onInput={emit} onKeyUp={syncBlock} onMouseUp={syncBlock} onBlur={keep}
          onPaste={(e) => { e.preventDefault(); const t = e.clipboardData.getData("text/plain"); exec("insertText", t); emit(); }} />}
    <p className="k rte-hint">Fields such as <span className="ph-chip">Presiding officer</span> fill in from Configuration whenever the policy is shown.</p>
  </div>;
}
