// /api/get-tasks.js
// Proxies read requests to Asana. ASANA_PAT stays server-side only.
//
// Returns: { tasks: [...normalized tasks], fetched_at: ISO timestamp }
// Query params:
//   ?scope=active    -> only incomplete tasks (default)
//   ?scope=completed -> only completed tasks
//   ?scope=all       -> both

const PROJECT_GID = process.env.ASANA_PROJECT_GID || '1213046253934403';
const ASANA_PAT = process.env.ASANA_PAT;

// Custom field GIDs (hardcoded so clients can't inject arbitrary field names)
const FIELD_GIDS = {
  status: '1214026068981717',
  urgent: '1214145041230569',
  company: '1213831450479886',
  btc_vertical: '1213831450479893',
  team: '1214130958768804',
  priority: '1213831450479879',
  date_requested: '1213816753397469',
  task_category: '1214163745067806',
};

const OPT_FIELDS = [
  'name',
  'due_on',
  'completed',
  'completed_at',
  'permalink_url',
  'modified_at',
  'created_at',
  'assignee.name',
  'assignee.gid',
  'memberships.section.name',
  'memberships.section.gid',
  'memberships.project.gid',
  'custom_fields.gid',
  'custom_fields.name',
  'custom_fields.display_value',
  'custom_fields.enum_value.name',
  'custom_fields.enum_value.gid',
].join(',');

// Module-scoped cache. Survives warm invocations; cold starts rebuild it.
let cache = { key: null, data: null, expires: 0 };
const CACHE_TTL_MS = 30 * 1000;

async function fetchAllPages(baseUrl) {
  let url = baseUrl;
  const allTasks = [];
  let pageCount = 0;
  const MAX_PAGES = 20; // safety ceiling

  while (url && pageCount < MAX_PAGES) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ASANA_PAT}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Asana API ${response.status}: ${text.slice(0, 300)}`);
    }

    const json = await response.json();
    allTasks.push(...(json.data || []));
    url = json.next_page?.uri || null;
    pageCount += 1;
  }

  return allTasks;
}

function normalizeTask(raw) {
  const cfMap = {};
  for (const cf of raw.custom_fields || []) {
    cfMap[cf.gid] = cf;
  }

  const getEnum = (gid) => {
    const cf = cfMap[gid];
    return cf?.enum_value?.name || null;
  };

  const getDisplay = (gid) => {
    const cf = cfMap[gid];
    return cf?.display_value || null;
  };

  // Find the section within *this* project
  let section = null;
  for (const m of raw.memberships || []) {
    if (m.project?.gid === PROJECT_GID) {
      section = m.section ? { gid: m.section.gid, name: m.section.name } : null;
      break;
    }
  }

  return {
    gid: raw.gid,
    name: raw.name,
    url: raw.permalink_url,
    due_on: raw.due_on,
    completed: raw.completed,
    completed_at: raw.completed_at,
    modified_at: raw.modified_at,
    created_at: raw.created_at,
    assignee: raw.assignee ? { gid: raw.assignee.gid, name: raw.assignee.name } : null,
    section,
    fields: {
      status: getEnum(FIELD_GIDS.status),
      urgent: getEnum(FIELD_GIDS.urgent), // "Yes" or null
      company: getEnum(FIELD_GIDS.company),
      btc_vertical: getEnum(FIELD_GIDS.btc_vertical),
      team: getEnum(FIELD_GIDS.team),
      priority: getEnum(FIELD_GIDS.priority),
      date_requested: getDisplay(FIELD_GIDS.date_requested),
      task_category: getEnum(FIELD_GIDS.task_category),
    },
  };
}

export default async function handler(req, res) {
  // Lock down method
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!ASANA_PAT) {
    res.status(500).json({ error: 'Server misconfigured: ASANA_PAT not set' });
    return;
  }

  const scope = (req.query?.scope || 'active').toString();
  if (!['active', 'completed', 'all'].includes(scope)) {
    res.status(400).json({ error: 'Invalid scope. Use active | completed | all' });
    return;
  }

  const cacheKey = `${PROJECT_GID}:${scope}`;
  const now = Date.now();
  if (cache.key === cacheKey && cache.data && cache.expires > now) {
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(cache.data);
    return;
  }

  try {
    // completed_since=now returns only incomplete tasks
    // For completed or all, we fetch everything then filter
    const params = new URLSearchParams({
      opt_fields: OPT_FIELDS,
      limit: '100',
    });
    if (scope === 'active') {
      params.set('completed_since', 'now');
    }

    const url = `https://app.asana.com/api/1.0/projects/${PROJECT_GID}/tasks?${params.toString()}`;
    const rawTasks = await fetchAllPages(url);

    let tasks = rawTasks.map(normalizeTask);
    if (scope === 'completed') {
      tasks = tasks.filter((t) => t.completed);
    }

    const payload = {
      tasks,
      fetched_at: new Date().toISOString(),
      scope,
      count: tasks.length,
    };

    cache = { key: cacheKey, data: payload, expires: now + CACHE_TTL_MS };

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.status(200).json(payload);
  } catch (err) {
    console.error('get-tasks error:', err);
    res.status(502).json({ error: 'Upstream error', message: err.message });
  }
}
