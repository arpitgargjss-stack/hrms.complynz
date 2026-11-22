# UI guardrails

Status: standing rule. Owner: product. Applies to every screen in the HRMS client (`client/src`).
Brand: Complynz logo blue (`--brand: #0048e4`, dark mode `#7aa2ff`). Every page must work in light and dark mode and at phone width.

## Tone

- **Admin/compliance screens: professional tone. No emojis in data UI, restrained colour, blue for actions only.**
  Status uses red (overdue), amber (due soon, to set up) and slate (neutral); green only for "done" and health bars.
  Surfaces on these screens use an 8px radius, 1px borders and no shadows or gradients; controls use a 6px radius.
  Copy is short and neutral ("Overdue by 24 days", "New at current headcount"). Reference: `client/src/pages/Compliance.tsx`.

## Form controls and spacing

The tokens and shared classes live at the end of `client/src/styles.css` ("Form controls and spacing"). Use them; do not
restyle controls page by page.

| Token | Value | Used for |
| --- | --- | --- |
| `--ctl-h` | `40px` (`44px` below 700px wide, for touch) | Height of every input, select, date/time field and `.btn` |
| `--ctl-h-sm` | `36px` | Small buttons (`.btn.sm`) and compact chips inside cards |
| `--ctl-r` | `10px` | Radius of inputs, selects, textareas and buttons. Pills (`999px`) only for filter chips and pill filters |
| `--ctl-px` | `12px` | Left padding inside inputs and selects |
| `--gap-label` | `6px` | Between a label and its field |
| `--gap-field` | `12px` | Between fields in the same row |
| `--gap-actions` | `16px` | Between the last row of fields and the action buttons |

Rules:

1. **Selects draw their own chevron.** Every single-line `select` has `appearance: none`, the `--chevron` SVG placed
   `14px` from the right, and `padding-right: 40px`, so the text never runs under the arrow and the arrow never touches
   the edge. If a page overrides a select's `padding`, it must set only `padding-left`, never the shorthand.
2. **One height for controls that sit side by side.** Inputs, selects, date fields, buttons and filter chips in the same
   row share `--ctl-h` (or all use `--ctl-h-sm`). No `min-height` or vertical padding hacks per page.
3. **One radius.** Controls use `--ctl-r`; a row of pill filters may use `999px`, but then every control in that row is a pill.
4. **Fixed gaps.** Label to field `6px`, field to field `12px`, fields to actions `16px`. Lay forms out with
   `.form-row` (fields, wraps on small screens) followed by `.form-actions` (buttons).
5. **Never let an action row touch the fields above it.** Buttons always sit `--gap-actions` below the last field.
   A fallback rule also adds this gap after any `.row-gap` that contains fields, but new code uses `.form-actions`.
6. **Primary button is `.btn.p`.** There is no `.btn.primary` class; do not use it.
7. **Check dark mode.** Controls get their dark colours from the shared `[data-theme=dark]` rules; the chevron switches
   colour through `--chevron`. Do not hard-code light backgrounds on controls.

Example:

```tsx
<div className="form-row">
  <Field label="Done on"><input type="date" /></Field>
  <Field label="Note"><input /></Field>
</div>
<div className="form-actions">
  <button className="btn p">Save</button>
  <button className="btn">Cancel</button>
</div>
```
