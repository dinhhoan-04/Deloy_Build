# Draft Feature Design

**Date:** 2026-05-15  
**Scope:** Chrome extension (DraftTab) + FastAPI backend  
**Goal:** Complete the "verify → save → organize → export" demo loop by adding persistent drafts with inline editing and file export.

---

## 1. Data Model

### New table: `drafts`

```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE
user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
run_id      UUID REFERENCES runs(id) ON DELETE SET NULL
title       TEXT NOT NULL DEFAULT 'Untitled Draft'
markdown    TEXT NOT NULL
sections    JSONB NOT NULL DEFAULT '[]'
created_at  TIMESTAMP NOT NULL DEFAULT now()
updated_at  TIMESTAMP NOT NULL DEFAULT now()

UNIQUE(project_id, user_id)  -- 1 draft per project per user
```

---

## 2. Backend API

All endpoints require auth (`current_user` dep, same as existing routers).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/drafts` | Upsert draft (create or overwrite). Body: `{project_id, run_id?, title?, markdown, sections?}` |
| `GET` | `/v1/drafts?project_id=<id>` | Get current draft for project. Returns 404 if none. |
| `PATCH` | `/v1/drafts/{id}` | Update title and/or markdown. Body: `{title?, markdown?}` |
| `DELETE` | `/v1/drafts/{id}` | Delete draft. |
| `GET` | `/v1/drafts/{id}/export?format=md\|docx` | Download `.md` or `.docx` file. |

### Export implementation

**Markdown:** Return raw `markdown` field with `Content-Disposition: attachment; filename="<title>.md"`.

**DOCX:** Use `python-docx`. Parse markdown line-by-line:
- `# text` → `doc.add_heading(text, level=1)`
- `## text` → `doc.add_heading(text, level=2)`
- `### text` → `doc.add_heading(text, level=3)`
- Empty line → skip
- Everything else → `doc.add_paragraph(text)`
- Inline citations like `[c1]` remain as-is in paragraph text
- Bold/italic/tables not rendered (out of scope for demo)

Return bytes with `Content-Disposition: attachment; filename="<title>.docx"` and `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

DOCX generation runs inline in the request handler — no worker needed. `python-docx` is lightweight and safe on Render free tier.

---

## 3. Frontend (DraftTab)

### Layout

```
┌─────────────────────────────────────┐
│  Claim selector (max 160px, scroll) │  unchanged
├─────────────────────────────────────┤
│  [Short] [Default] [Long]  [Generate] [Save] │
├─────────────────────────────────────┤
│  Title: ___________________________  │  editable input, shown when draft exists
│  ─────────────────────────────────  │
│  Markdown textarea (flex-1, scroll) │  editable, shown when draft exists
│  ─────────────────────────────────  │
│  [↓ .md]  [↓ .docx]  [🗑 Delete]   │  footer, shown when draft exists
└─────────────────────────────────────┘
```

### State (Zustand — add to store)

```ts
draft: {
  data: Draft | null      // { id, title, markdown, sections, run_id, updated_at }
  saving: boolean         // POST/PATCH in flight
  dirty: boolean          // unsaved auto-save changes
}
```

### Interaction flow

1. **Tab load:** `GET /v1/drafts?project_id=...` — if draft exists, populate editor immediately.
2. **After generate:** stream completes → `stream.finalContent` available → nút **Save** becomes active.
3. **Click Save:** `POST /v1/drafts` with `{project_id, run_id, markdown, sections, title: 'Untitled Draft'}` → on success, store draft in Zustand → switch to saved mode.
4. **Saved mode:** title becomes `<input>` editable inline; markdown becomes `<textarea>`; both auto-save on blur via `PATCH /v1/drafts/{id}`.
5. **Auto-save failure:** set `dirty: true`, show small "Unsaved changes" indicator below title. Keep retrying on next blur.
6. **Export:** click button → `fetch /v1/drafts/{id}/export?format=md|docx` → `URL.createObjectURL` → trigger download.
7. **Delete:** confirm dialog → `DELETE /v1/drafts/{id}` → reset store to `{ data: null }` → show empty state.

### Error handling

| Scenario | Behavior |
|----------|----------|
| Generate fail | Error banner below output (existing stream.error) |
| Save fail | Toast "Failed to save draft" + keep Save button active |
| Export fail | Toast "Export failed" |
| Auto-save fail | `dirty: true` + "Unsaved changes" indicator |

---

## 4. Constraints & Scope

- **Render free tier:** all operations inline, no background worker.
- **1 draft per project per user:** upsert on POST, no list/pagination UI needed.
- **No rich markdown editor:** plain `<textarea>` — sufficient for demo.
- **No version history:** overwrite is intentional.
- **`python-docx`** added to `requirements.txt` / `pyproject.toml`.
