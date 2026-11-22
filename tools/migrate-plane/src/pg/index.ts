/**
 * Reads Plane and ATC from Postgres into a PlaneData snapshot. Read-only: the session
 * is set read-only and nothing here issues a write. Needs a live database, so it is
 * covered by the real dry run rather than unit tests.
 */
import pg from 'pg';
import type {
  PlaneComment,
  PlaneData,
  PlaneIssue,
  PlaneLink,
  PlaneModule,
  PlaneProject,
  PlaneRelation,
} from '../source.js';

const iso = (v: Date | string | null): string => (v ? new Date(v).toISOString() : new Date(0).toISOString());

type Row = Record<string, unknown>;

export async function loadPlane(dsn: string): Promise<PlaneData> {
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    // Belt and braces: the session cannot write even by accident.
    await client.query('SET default_transaction_read_only = on');
    const q = async (sql: string): Promise<Row[]> => (await client.query(sql)).rows as Row[];

    const projectRows = await q(
      `SELECT id, identifier, name, description, created_at, archived_at FROM projects
        WHERE deleted_at IS NULL AND identifier <> 'JOBS' ORDER BY identifier`,
    );
    const ids = projectRows.map((r) => r.id as string);
    const inProjects = `project_id = ANY('{${ids.join(',')}}'::uuid[])`;

    const stateRows = await q(
      `SELECT id, project_id, name, "group", sequence FROM states WHERE deleted_at IS NULL AND ${inProjects} ORDER BY sequence`,
    );
    const labelRows = await q(
      `SELECT id, project_id, name FROM labels WHERE deleted_at IS NULL AND ${inProjects} ORDER BY sort_order, name`,
    );
    const atcProjects = await q('SELECT * FROM atc.project');
    const atcModules = await q('SELECT * FROM atc.module');

    const projects: PlaneProject[] = projectRows.map((r) => {
      const id = r.id as string;
      const atc = atcProjects.find((a) => a.plane_id === id);
      const card = atcModules.find((m) => m.project_id === id && m.unsorted);
      return {
        id,
        identifier: r.identifier as string,
        name: r.name as string,
        description: (r.description as string | null) ?? '',
        createdAt: iso(r.created_at as Date),
        archived: r.archived_at != null,
        states: stateRows
          .filter((s) => s.project_id === id)
          .map((s) => ({
            id: s.id as string,
            name: s.name as string,
            group: s.group as string,
            sequence: Number(s.sequence),
          })),
        labels: labelRows
          .filter((l) => l.project_id === id)
          .map((l) => ({ id: l.id as string, name: l.name as string })),
        ...(atc
          ? {
              atc: {
                columnKey: atc.column_key as string,
                rank: atc.rank as string,
                repo: (atc.repo as string | null) ?? null,
                deploys: atc.deploys as boolean,
                deployAction: (atc.deploy_action as string) ?? '',
                bauEnabled: atc.bau_enabled as boolean,
                hidden: atc.hidden_at != null,
              },
            }
          : {}),
        ...(card
          ? {
              atcProjectCard: {
                columnKey: card.column_key as string,
                columnRank: card.column_rank as string,
                hidden: card.hidden_at != null,
              },
            }
          : {}),
      };
    });

    const issueRows = await q(
      `SELECT i.id, i.project_id, i.sequence_id, i.name, i.description_html, i.priority, i.sort_order,
              i.parent_id, i.state_id, i.created_at, i.updated_at, u.email AS created_by, i.archived_at,
              w.points
         FROM issues i
         LEFT JOIN users u ON u.id = i.created_by_id
         LEFT JOIN atc.work_item w ON w.plane_id = i.id
        WHERE i.deleted_at IS NULL AND i.is_draft = false AND i.${inProjects}
        ORDER BY i.project_id, i.sort_order, i.sequence_id`,
    );
    const issueLabelRows = await q(
      'SELECT issue_id, label_id FROM issue_labels WHERE deleted_at IS NULL ORDER BY created_at',
    );
    const linkRows = await q(
      'SELECT id, issue_id, title, url FROM issue_links WHERE deleted_at IS NULL ORDER BY created_at',
    );
    const labelsByIssue = new Map<string, string[]>();
    for (const r of issueLabelRows) {
      const list = labelsByIssue.get(r.issue_id as string) ?? [];
      list.push(r.label_id as string);
      labelsByIssue.set(r.issue_id as string, list);
    }
    const linksByIssue = new Map<string, PlaneLink[]>();
    for (const r of linkRows) {
      const list = linksByIssue.get(r.issue_id as string) ?? [];
      list.push({ id: r.id as string, url: r.url as string, title: (r.title as string | null) || null });
      linksByIssue.set(r.issue_id as string, list);
    }
    const issues: PlaneIssue[] = issueRows.map((r) => ({
      id: r.id as string,
      projectId: r.project_id as string,
      sequence: Number(r.sequence_id),
      name: r.name as string,
      html: (r.description_html as string | null) ?? '',
      priority: (r.priority as string | null) ?? 'none',
      sortOrder: Number(r.sort_order),
      parentId: (r.parent_id as string | null) ?? null,
      stateId: (r.state_id as string | null) ?? null,
      createdAt: iso(r.created_at as Date),
      updatedAt: iso(r.updated_at as Date),
      createdByEmail: (r.created_by as string | null) ?? null,
      labelIds: labelsByIssue.get(r.id as string) ?? [],
      points: r.points == null ? null : Number(r.points),
      archived: r.archived_at != null,
      links: linksByIssue.get(r.id as string) ?? [],
    }));
    const live = new Set(issues.map((i) => i.id));

    const commentRows = await q(
      `SELECT c.id, c.issue_id, c.comment_html, c.created_at, u.email
         FROM issue_comments c LEFT JOIN users u ON u.id = COALESCE(c.actor_id, c.created_by_id)
        WHERE c.deleted_at IS NULL ORDER BY c.created_at, c.id`,
    );
    const comments: PlaneComment[] = commentRows
      .filter((r) => live.has(r.issue_id as string))
      .map((r) => ({
        id: r.id as string,
        issueId: r.issue_id as string,
        html: (r.comment_html as string | null) ?? '',
        authorEmail: (r.email as string | null) ?? null,
        createdAt: iso(r.created_at as Date),
      }));

    const relationRows = await q(
      'SELECT issue_id, related_issue_id, relation_type FROM issue_relations WHERE deleted_at IS NULL ORDER BY created_at, id',
    );
    const relations: PlaneRelation[] = relationRows
      .filter((r) => live.has(r.issue_id as string) && live.has(r.related_issue_id as string))
      .map((r) => ({
        issueId: r.issue_id as string,
        relatedIssueId: r.related_issue_id as string,
        type: r.relation_type as string,
      }));

    const moduleRows = await q(
      `SELECT m.id, m.project_id, m.name, m.description, m.status, m.created_at, m.archived_at, u.email AS created_by
         FROM modules m LEFT JOIN users u ON u.id = m.created_by_id
        WHERE m.deleted_at IS NULL AND m.${inProjects} ORDER BY m.sort_order, m.created_at`,
    );
    const memberRows = await q(
      `SELECT mi.module_id, mi.issue_id FROM module_issues mi JOIN issues i ON i.id = mi.issue_id
        WHERE mi.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY i.sort_order, i.sequence_id`,
    );
    const modules: PlaneModule[] = moduleRows.map((r) => {
      const atc = atcModules.find((a) => a.id === r.id && !a.unsorted);
      return {
        id: r.id as string,
        projectId: r.project_id as string,
        name: r.name as string,
        description: (r.description as string | null) ?? '',
        status: (r.status as string | null) ?? null,
        createdAt: iso(r.created_at as Date),
        createdByEmail: (r.created_by as string | null) ?? null,
        archived: r.archived_at != null,
        issueIds: memberRows
          .filter((m) => m.module_id === r.id && live.has(m.issue_id as string))
          .map((m) => m.issue_id as string),
        ...(atc
          ? {
              atc: {
                columnKey: atc.column_key as string,
                columnRank: atc.column_rank as string,
                hidden: atc.hidden_at != null,
              },
            }
          : {}),
      };
    });

    return { projects, issues, comments, relations, modules };
  } finally {
    await client.end();
  }
}

/** Everything in JOBS (and the workspace's pages), for the archive. Read-only. */
export async function loadArchive(dsn: string): Promise<Record<string, unknown>> {
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const q = async (sql: string): Promise<Row[]> => (await client.query(sql)).rows as Row[];
    const [project] = await q(
      `SELECT id, identifier, name, description FROM projects WHERE identifier = 'JOBS'`,
    );
    if (!project) return { project: null, issues: [], pages: [] };
    const id = project.id as string;
    const issues = await q(
      `SELECT i.id, i.sequence_id, i.name, i.priority, i.created_at, i.updated_at, i.description_html, s.name AS state,
              (SELECT coalesce(json_agg(l.name), '[]') FROM issue_labels il JOIN labels l ON l.id = il.label_id
                WHERE il.issue_id = i.id AND il.deleted_at IS NULL) AS labels,
              (SELECT coalesce(json_agg(json_build_object('at', c.created_at, 'html', c.comment_html) ORDER BY c.created_at), '[]')
                 FROM issue_comments c WHERE c.issue_id = i.id AND c.deleted_at IS NULL) AS comments,
              (SELECT coalesce(json_agg(json_build_object('title', k.title, 'url', k.url)), '[]')
                 FROM issue_links k WHERE k.issue_id = i.id AND k.deleted_at IS NULL) AS links
         FROM issues i LEFT JOIN states s ON s.id = i.state_id
        WHERE i.project_id = '${id}' AND i.deleted_at IS NULL ORDER BY i.sequence_id`,
    );
    const pages = await q(
      'SELECT id, name, description_html, created_at, updated_at, archived_at FROM pages WHERE deleted_at IS NULL ORDER BY created_at',
    );
    return { project, issues, pages };
  } finally {
    await client.end();
  }
}
