-- Migration 006: per-project sharing ACL.
--
-- Until now, project access was gated solely by `projects.org_id` matching
-- `memberships.org_id` (see src/lib/auth/require-project-access.ts). That
-- model meant the only way to "share" a project was to add the recipient as
-- a member of your *entire* org — giving them every project at once.
--
-- This table grants per-project access without crossing the org boundary:
-- the recipient stays in their own personal org but gains read/write to one
-- specific project. The owner can revoke any time by deleting the row.
--
-- `role` is reserved for future viewer/editor distinction; v1 ships with
-- 'member' only, equivalent to org-level access (full read/write except
-- deleting the project and managing membership — owner-only via org match).
CREATE TABLE IF NOT EXISTS project_members (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',
  added_by    TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, user_id)
);

-- Hot paths: list members of one project; list projects shared with one user.
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user    ON project_members(user_id);

COMMENT ON TABLE  project_members IS 'Per-project ACL granting access outside the owning org.';
COMMENT ON COLUMN project_members.role IS 'Role: ''member'' (v1). Reserved for ''viewer''/''editor'' split.';
