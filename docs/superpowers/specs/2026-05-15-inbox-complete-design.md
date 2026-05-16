# Inbox Hoàn Chỉnh — Design Spec

**Date:** 2026-05-15
**Status:** Approved — ready for implementation planning
**Goal:** Demo/MVP — luồng "verify → save → organize" hoàn chỉnh, không có broken state

---

## Context & Motivation

Extension hiện tại có verify hoạt động end-to-end. Điểm yếu lớn nhất cho demo là Inbox:

- `archiveMany` thực chất là `DELETE` — item biến mất, không unarchive được
- Không có filter/sort — khó navigate khi có nhiều claims
- Project delete thiếu — người dùng thử nghiệm tạo project test không dọn được
- Error im lặng — API fail không có feedback rõ ràng

Scope: chỉ sửa những gì cần thiết để demo story "verify → save → organize" chạy mượt mà trước mặt người xem.

---

## Phần 1 — Backend: Archive thật

### Thay đổi schema

Thêm column vào bảng `inbox_items`:

```sql
ALTER TABLE inbox_items ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;
```

`NULL` = active. Non-null = archived (giá trị là thời điểm archive).

### Endpoint thay đổi

**Thêm mới: `PATCH /v1/inbox/:id`**

```json
// Archive
{ "archived_at": "2026-05-15T10:00:00Z" }

// Unarchive
{ "archived_at": null }
```

Response: inbox item đã cập nhật.

**Giữ nguyên: `DELETE /v1/inbox/:id`** — vẫn dùng cho "xóa hẳn" nếu cần.

**`GET /v1/inbox?project_id=X`** — trả về tất cả items (cả active lẫn archived). Frontend tự filter. Lý do: inbox một project không đủ lớn để cần server-side filter; tránh thêm query param phức tạp.

### Endpoint project mới

**`PATCH /v1/projects/:id`** — đổi tên:
```json
{ "name": "New name" }
```

**`DELETE /v1/projects/:id`** — xóa project.
- Guard: nếu có run đang chạy (`status IN ('queued','running')`), trả về `409 Conflict` với message rõ ràng.
- Cascade: backend tự xóa claims, inbox items, conflicts liên quan (hoặc soft delete tùy schema hiện tại).

---

## Phần 2 — Frontend: InboxTab

### Layout tổng quát

```
┌─ Inbox ─────────────────────────────────────────────┐
│ [Active (12)]  [Archived (3)]          [Newest ▾]   │
│ ─────────────────────────────────────────────────── │
│ (chỉ Active) [All]  [Verified]  [Partial]            │
│ ─────────────────────────────────────────────────── │
│ <PaperGroup list>                                    │
│                                                      │
│ ─────────────────────────────────────────────────── │
│ (khi có selected) 3 selected  [Archive] [Add] [×]   │
└──────────────────────────────────────────────────────┘
```

### Active / Archived toggle

Hai pill button ngay đầu tab, hiển thị count:
- **Active** — items có `archived_at = null`
- **Archived** — items có `archived_at != null`

Switch giữa hai view không reset filter/sort.

### Filter pills (chỉ ở Active view)

```
[All]  [Verified]  [Partial]
```

Filter theo `status` của claim tương ứng. Style giống filter pills ở VerifyTab (đã có sẵn).

### Sort dropdown

Góc phải trên cùng, nhỏ, 2 options:
- Newest first (mặc định) — sort theo `saved_at` DESC
- Oldest first — sort theo `saved_at` ASC

Implement bằng `useState` local, không cần persist.

### Bulk action bar

Giữ nguyên vị trí và style hiện tại. Thay đổi hành vi:

| View | Nút hiện | Action |
|------|----------|--------|
| Active | Archive, Add to project, × | `archiveMany(ids)` |
| Archived | Unarchive, × | `unarchiveMany(ids)` |

"Add to project" chỉ xuất hiện ở Active view.

### State thay đổi trong store

**`InboxSlice` — thêm:**

```ts
archiveMany(inboxIds: string[]): Promise<void>
// Đổi: gọi PATCH { archived_at: now } thay vì DELETE

unarchiveMany(inboxIds: string[]): Promise<void>
// Mới: gọi PATCH { archived_at: null }
```

Cả hai reload inbox sau khi xong.

**API client — thêm:**

```ts
export async function patchInboxItem(
  inboxId: string,
  patch: { archived_at: string | null }
): Promise<InboxItem>
```

---

## Phần 3 — Project Management

### Edit/Delete trong Footer

Khi hover vào project name trong Footer, hiện icon ✏️. Click mở `ProjectEditModal`:

- Input text đổi tên → gọi `PATCH /projects/:id` → update store
- Nút "Delete project" (màu đỏ) → confirm dialog: *"Delete '[name]'? This cannot be undone."*
  - Confirm → `DELETE /projects/:id`
  - Nếu backend trả 409 (run đang chạy): toast "Cannot delete — a run is in progress"
  - Nếu thành công: switch sang project đầu tiên còn lại, reload store

### Store thay đổi

**`ProjectsSlice` — thêm:**

```ts
updateProject(id: string, name: string): Promise<void>
deleteProject(id: string): Promise<void>
```

`deleteProject` sau khi thành công: lọc project ra khỏi `projects.data`, nếu `currentProjectId === id` thì switch sang `projects.data[0]`.

---

## Phần 4 — Error Surfaces

### Inline error banner trong tabs

Khi `loadInbox` / `loadClaims` / `loadConflicts` fail, thay vì im lặng, hiện banner nhỏ trong tab:

```
┌──────────────────────────────────────────┐
│ ⚠ Could not load inbox.  [Retry]         │
└──────────────────────────────────────────┘
```

Style: background `var(--rk-surface-warm)`, border `1px solid #fbbf24`, text nhỏ. Nút Retry gọi lại load function.

Implement bằng cách check `inbox.status === 'error'` (đã có trong `Slice` type).

### Toast messages cải thiện

Thay các toast generic bằng message cụ thể hơn:

| Trước | Sau |
|-------|-----|
| "Save failed. Please retry." | "Save failed — network error. Please retry." |
| (không có) | "Archive failed. Please retry." |
| (không có) | "Unarchive failed. Please retry." |

Error message lấy từ `ApiError.message` khi có thể.

---

## Out of scope

- Conflict resolution thật — không đụng đến
- Draft generation — không đụng đến
- Verify trạng thái thêm — đã hoạt động, không cần thay đổi
- Telemetry / E2E tests — post-demo
- Infinite scroll / pagination cho inbox — không cần ở scale demo

---

## File thay đổi dự kiến

### Backend
- Migration: thêm `archived_at` column
- `inbox_router.py`: thêm PATCH endpoint
- `projects_router.py`: thêm PATCH + DELETE endpoint

### Frontend (extension)
- `src/shared/api.ts` — thêm `patchInboxItem`, `updateProject`, `deleteProject`
- `src/shared/types.ts` — thêm `archived_at` field vào `InboxItem`
- `src/sidebar/state/slices/inbox.ts` — đổi `archiveMany`, thêm `unarchiveMany`
- `src/sidebar/state/slices/projects.ts` — thêm `updateProject`, `deleteProject`
- `src/sidebar/components/tabs/InboxTab.tsx` — thêm Active/Archived toggle, filter, sort
- `src/sidebar/components/atoms/ProjectEditModal.tsx` — component mới
- `src/sidebar/components/shell/Footer.tsx` — thêm edit icon + trigger modal
- `src/sidebar/App.tsx` — wire `unarchiveMany`, `updateProject`, `deleteProject`

---

## Success criteria cho demo

1. Verify một claim → Save to inbox → item xuất hiện ở Active tab ✓
2. Archive nhiều items → chuyển sang Archived tab → vẫn thấy ✓
3. Unarchive → item trở về Active tab ✓
4. Filter Verified/Partial trong Active tab hoạt động ✓
5. Sort Newest/Oldest hoạt động ✓
6. Refresh extension → inbox vẫn đúng (load từ backend) ✓
7. Switch project → inbox đổi theo project ✓
8. Delete project test → project biến mất, auto switch ✓
9. API fail → hiện error banner + Retry, không màn hình trắng ✓
