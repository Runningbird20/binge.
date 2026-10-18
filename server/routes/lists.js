const crypto = require('crypto');
const express = require('express');

const db = require('../db');
const { optionalAuth, requireAuth } = require('../middleware/auth');

const router = express.Router();

const MEDIA_TABLES = {
  movie: 'movies',
  tv_show: 'tv_shows',
  book: 'books',
};

function normalizeListName(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.slice(0, 80);
}

function normalizeVoteValue(value) {
  const numericValue = Number(value);
  if (numericValue === 1 || numericValue === -1 || numericValue === 0) {
    return numericValue;
  }
  return null;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function slugifyListName(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  return slug || 'shared-list';
}

function createShareCode(name) {
  const slug = slugifyListName(name);

  while (true) {
    const candidate = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    const existing = db
      .prepare('SELECT id FROM media_lists WHERE share_code = ?')
      .get(candidate);

    if (!existing) {
      return candidate;
    }
  }
}

function toPermissions(list) {
  const canEdit = Boolean(list.is_owner || list.is_collaborator);
  const canView = Boolean(list.is_public || canEdit);

  return {
    canView,
    canEdit,
    canManage: Boolean(list.is_owner),
    canVote: canEdit,
    role: list.is_owner ? 'owner' : list.is_collaborator ? 'collaborator' : 'viewer',
  };
}

function getListRecordById(listId, userId) {
  const safeUserId = Number(userId) || 0;

  const list = db.prepare(`
    SELECT
      l.id,
      l.user_id,
      l.name,
      l.share_code,
      l.is_public,
      l.created_at,
      l.updated_at,
      owner.username AS owner_username,
      CASE WHEN l.user_id = ? THEN 1 ELSE 0 END AS is_owner,
      CASE WHEN EXISTS (
        SELECT 1
        FROM media_list_collaborators collaborators
        WHERE collaborators.list_id = l.id
          AND collaborators.user_id = ?
      ) THEN 1 ELSE 0 END AS is_collaborator
    FROM media_lists l
    JOIN users owner ON owner.id = l.user_id
    WHERE l.id = ?
  `).get(safeUserId, safeUserId, Number(listId));

  if (!list) return null;

  return {
    ...list,
    is_public: Boolean(list.is_public),
    is_owner: Boolean(list.is_owner),
    is_collaborator: Boolean(list.is_collaborator),
    permissions: toPermissions(list),
  };
}

function getListRecordByShareCode(shareCode, userId) {
  const safeUserId = Number(userId) || 0;

  const list = db.prepare(`
    SELECT
      l.id,
      l.user_id,
      l.name,
      l.share_code,
      l.is_public,
      l.created_at,
      l.updated_at,
      owner.username AS owner_username,
      CASE WHEN l.user_id = ? THEN 1 ELSE 0 END AS is_owner,
      CASE WHEN EXISTS (
        SELECT 1
        FROM media_list_collaborators collaborators
        WHERE collaborators.list_id = l.id
          AND collaborators.user_id = ?
      ) THEN 1 ELSE 0 END AS is_collaborator
    FROM media_lists l
    JOIN users owner ON owner.id = l.user_id
    WHERE l.share_code = ?
  `).get(safeUserId, safeUserId, shareCode);

  if (!list) return null;

  return {
    ...list,
    is_public: Boolean(list.is_public),
    is_owner: Boolean(list.is_owner),
    is_collaborator: Boolean(list.is_collaborator),
    permissions: toPermissions(list),
  };
}

function touchList(listId) {
  db.prepare('UPDATE media_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(listId);
}

function normalizeItemPositions(listId) {
  const items = db
    .prepare('SELECT id FROM media_list_items WHERE list_id = ? ORDER BY position ASC, id ASC')
    .all(listId);

  const updatePosition = db.prepare(
    'UPDATE media_list_items SET position = ? WHERE id = ? AND list_id = ?'
  );

  const transaction = db.transaction(() => {
    items.forEach((item, index) => {
      updatePosition.run(index, item.id, listId);
    });
  });

  transaction();
}

function getNextItemPosition(listId) {
  const row = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM media_list_items WHERE list_id = ?')
    .get(listId);

  return Number(row?.next_position) || 0;
}

function ensureMediaExists(mediaType, mediaId) {
  const tableName = MEDIA_TABLES[mediaType];
  if (!tableName) return null;

  return db
    .prepare(`SELECT id, title FROM ${tableName} WHERE id = ? AND source_key IS NOT NULL`)
    .get(Number(mediaId));
}

function getCollaborators(list) {
  const collaborators = db.prepare(`
    SELECT users.id, users.username
    FROM media_list_collaborators collaborators
    JOIN users ON users.id = collaborators.user_id
    WHERE collaborators.list_id = ?
    ORDER BY LOWER(users.username) ASC
  `).all(list.id);

  return [
    {
      id: list.user_id,
      username: list.owner_username,
      role: 'owner',
    },
    ...collaborators.map((collaborator) => ({
      ...collaborator,
      role: 'collaborator',
    })),
  ];
}

function getListItems(listId, currentUserId) {
  const safeUserId = Number(currentUserId) || 0;

  const rows = db.prepare(`
    SELECT
      items.id,
      items.list_id,
      items.media_type,
      items.media_id,
      items.position,
      items.added_at,
      CASE items.media_type
        WHEN 'movie' THEN (SELECT title FROM movies WHERE id = items.media_id)
        WHEN 'tv_show' THEN (SELECT title FROM tv_shows WHERE id = items.media_id)
        WHEN 'book' THEN (SELECT title FROM books WHERE id = items.media_id)
      END AS title,
      CASE items.media_type
        WHEN 'movie' THEN (SELECT poster_url FROM movies WHERE id = items.media_id)
        WHEN 'tv_show' THEN (SELECT poster_url FROM tv_shows WHERE id = items.media_id)
        WHEN 'book' THEN (SELECT cover_url FROM books WHERE id = items.media_id)
      END AS image_url,
      CASE items.media_type
        WHEN 'movie' THEN (SELECT year FROM movies WHERE id = items.media_id)
        WHEN 'tv_show' THEN (SELECT year FROM tv_shows WHERE id = items.media_id)
        WHEN 'book' THEN (SELECT year FROM books WHERE id = items.media_id)
      END AS year,
      CASE items.media_type
        WHEN 'movie' THEN (SELECT genre FROM movies WHERE id = items.media_id)
        WHEN 'tv_show' THEN (SELECT genre FROM tv_shows WHERE id = items.media_id)
        WHEN 'book' THEN (SELECT genre FROM books WHERE id = items.media_id)
      END AS genre,
      CASE items.media_type
        WHEN 'movie' THEN (SELECT director FROM movies WHERE id = items.media_id)
        WHEN 'tv_show' THEN (SELECT creator FROM tv_shows WHERE id = items.media_id)
        WHEN 'book' THEN (SELECT author FROM books WHERE id = items.media_id)
      END AS creator_name,
      CASE items.media_type
        WHEN 'movie' THEN (SELECT COALESCE(overview, synopsis) FROM movies WHERE id = items.media_id)
        WHEN 'tv_show' THEN (SELECT COALESCE(overview, synopsis) FROM tv_shows WHERE id = items.media_id)
        WHEN 'book' THEN (SELECT synopsis FROM books WHERE id = items.media_id)
      END AS synopsis,
      COALESCE((
        SELECT SUM(votes.value)
        FROM media_list_votes votes
        WHERE votes.list_item_id = items.id
      ), 0) AS vibe_score,
      COALESCE((
        SELECT COUNT(*)
        FROM media_list_votes votes
        WHERE votes.list_item_id = items.id
          AND votes.value = 1
      ), 0) AS upvotes,
      COALESCE((
        SELECT COUNT(*)
        FROM media_list_votes votes
        WHERE votes.list_item_id = items.id
          AND votes.value = -1
      ), 0) AS downvotes,
      COALESCE((
        SELECT votes.value
        FROM media_list_votes votes
        WHERE votes.list_item_id = items.id
          AND votes.user_id = ?
      ), 0) AS my_vote
    FROM media_list_items items
    WHERE items.list_id = ?
    ORDER BY items.position ASC, items.id ASC
  `).all(safeUserId, listId);

  return rows
    .filter((row) => row.title)
    .map((row) => ({
      ...row,
      vibe_score: Number(row.vibe_score) || 0,
      upvotes: Number(row.upvotes) || 0,
      downvotes: Number(row.downvotes) || 0,
      my_vote: Number(row.my_vote) || 0,
    }));
}

function buildConsensusPick(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const [topItem] = [...items].sort((left, right) => {
    if ((right.vibe_score || 0) !== (left.vibe_score || 0)) {
      return (right.vibe_score || 0) - (left.vibe_score || 0);
    }
    if ((right.upvotes || 0) !== (left.upvotes || 0)) {
      return (right.upvotes || 0) - (left.upvotes || 0);
    }
    if ((left.downvotes || 0) !== (right.downvotes || 0)) {
      return (left.downvotes || 0) - (right.downvotes || 0);
    }
    return (left.position || 0) - (right.position || 0);
  });

  return topItem || null;
}

function buildListPayload(list, currentUserId) {
  const items = getListItems(list.id, currentUserId);

  return {
    id: list.id,
    name: list.name,
    share_code: list.share_code,
    is_public: Boolean(list.is_public),
    created_at: list.created_at,
    updated_at: list.updated_at,
    owner: {
      id: list.user_id,
      username: list.owner_username,
    },
    permissions: list.permissions,
    collaborators: getCollaborators(list),
    items,
    consensus_pick: buildConsensusPick(items),
  };
}

function requireEditableList(req, res) {
  const list = getListRecordById(req.params.id, req.user.id);
  if (!list || !list.permissions.canView) {
    res.status(404).json({ error: 'List not found' });
    return null;
  }

  if (!list.permissions.canEdit) {
    res.status(403).json({ error: 'You do not have permission to edit this list' });
    return null;
  }

  return list;
}

function requireManageableList(req, res) {
  const list = getListRecordById(req.params.id, req.user.id);
  if (!list || !list.permissions.canView) {
    res.status(404).json({ error: 'List not found' });
    return null;
  }

  if (!list.permissions.canManage) {
    res.status(403).json({ error: 'Only the list owner can manage collaborators and settings' });
    return null;
  }

  return list;
}

router.get('/shared/:shareCode', optionalAuth, (req, res) => {
  const viewer = req.user;
  const list = getListRecordByShareCode(req.params.shareCode, viewer?.id);

  if (!list || !list.permissions.canView) {
    return res.status(404).json({ error: 'List not found' });
  }

  res.json(buildListPayload(list, viewer?.id));
});

router.use(requireAuth);

router.get('/', (req, res) => {
  const lists = db.prepare(`
    SELECT
      l.id,
      l.name,
      l.share_code,
      l.is_public,
      l.created_at,
      l.updated_at,
      owner.username AS owner_username,
      CASE WHEN l.user_id = ? THEN 'owner' ELSE 'collaborator' END AS role,
      (
        SELECT COUNT(*)
        FROM media_list_items items
        WHERE items.list_id = l.id
      ) AS item_count,
      (
        SELECT COUNT(*)
        FROM media_list_collaborators collaborators
        WHERE collaborators.list_id = l.id
      ) AS collaborator_count
    FROM media_lists l
    JOIN users owner ON owner.id = l.user_id
    WHERE l.user_id = ?
      OR EXISTS (
        SELECT 1
        FROM media_list_collaborators collaborators
        WHERE collaborators.list_id = l.id
          AND collaborators.user_id = ?
      )
    ORDER BY l.updated_at DESC, l.created_at DESC
  `).all(req.user.id, req.user.id, req.user.id);

  res.json(
    lists.map((list) => ({
      id: list.id,
      name: list.name,
      share_code: list.share_code,
      is_public: Boolean(list.is_public),
      created_at: list.created_at,
      updated_at: list.updated_at,
      owner_username: list.owner_username,
      item_count: Number(list.item_count) || 0,
      collaborator_count: Number(list.collaborator_count) || 0,
      permissions: {
        canView: true,
        canEdit: true,
        canManage: list.role === 'owner',
        canVote: true,
        role: list.role,
      },
    }))
  );
});

router.post('/', (req, res) => {
  const name = normalizeListName(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'A list name is required' });
  }

  const shareCode = createShareCode(name);
  const result = db.prepare(`
    INSERT INTO media_lists (user_id, name, share_code, is_public)
    VALUES (?, ?, ?, ?)
  `).run(
    req.user.id,
    name,
    shareCode,
    normalizeBoolean(req.body?.is_public) ? 1 : 0
  );

  const list = getListRecordById(result.lastInsertRowid, req.user.id);
  res.status(201).json(buildListPayload(list, req.user.id));
});

router.get('/:id', (req, res) => {
  const list = getListRecordById(req.params.id, req.user.id);

  if (!list || !list.permissions.canView) {
    return res.status(404).json({ error: 'List not found' });
  }

  res.json(buildListPayload(list, req.user.id));
});

router.patch('/:id', (req, res) => {
  const list = requireManageableList(req, res);
  if (!list) return;

  const nextName = req.body?.name === undefined ? list.name : normalizeListName(req.body.name);
  const nextVisibility =
    req.body?.is_public === undefined ? list.is_public : normalizeBoolean(req.body.is_public);

  if (!nextName) {
    return res.status(400).json({ error: 'A list name is required' });
  }

  db.prepare(`
    UPDATE media_lists
    SET name = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextName, nextVisibility ? 1 : 0, list.id);

  const refreshedList = getListRecordById(list.id, req.user.id);
  res.json(buildListPayload(refreshedList, req.user.id));
});

router.delete('/:id', (req, res) => {
  const list = requireManageableList(req, res);
  if (!list) return;

  db.prepare('DELETE FROM media_lists WHERE id = ?').run(list.id);
  res.json({ success: true });
});

router.post('/:id/collaborators', (req, res) => {
  const list = requireManageableList(req, res);
  if (!list) return;

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (!username) {
    return res.status(400).json({ error: 'A username is required to invite a collaborator' });
  }

  const collaborator = db
    .prepare('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)')
    .get(username);

  if (!collaborator) {
    return res.status(404).json({ error: 'No user with that username was found' });
  }

  if (Number(collaborator.id) === Number(list.user_id)) {
    return res.status(400).json({ error: 'The owner already has access to this list' });
  }

  try {
    db.prepare(`
      INSERT INTO media_list_collaborators (list_id, user_id, invited_by_user_id)
      VALUES (?, ?, ?)
    `).run(list.id, collaborator.id, req.user.id);
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'That user is already a collaborator' });
    }

    return res.status(500).json({ error: 'Unable to add collaborator' });
  }

  touchList(list.id);
  const refreshedList = getListRecordById(list.id, req.user.id);
  res.status(201).json(buildListPayload(refreshedList, req.user.id));
});

router.delete('/:id/collaborators/:collaboratorId', (req, res) => {
  const list = requireManageableList(req, res);
  if (!list) return;

  const collaboratorId = Number(req.params.collaboratorId);
  if (!Number.isFinite(collaboratorId)) {
    return res.status(400).json({ error: 'Invalid collaborator id' });
  }

  const result = db.prepare(`
    DELETE FROM media_list_collaborators
    WHERE list_id = ? AND user_id = ?
  `).run(list.id, collaboratorId);

  if (!result.changes) {
    return res.status(404).json({ error: 'Collaborator not found' });
  }

  touchList(list.id);
  const refreshedList = getListRecordById(list.id, req.user.id);
  res.json(buildListPayload(refreshedList, req.user.id));
});

router.post('/:id/items', (req, res) => {
  const list = requireEditableList(req, res);
  if (!list) return;

  const mediaType = req.body?.media_type;
  const mediaId = Number(req.body?.media_id);

  if (!MEDIA_TABLES[mediaType] || !Number.isFinite(mediaId)) {
    return res.status(400).json({ error: 'media_type and media_id are required' });
  }

  const mediaItem = ensureMediaExists(mediaType, mediaId);
  if (!mediaItem) {
    return res.status(404).json({ error: 'Media item not found' });
  }

  try {
    db.prepare(`
      INSERT INTO media_list_items (list_id, media_type, media_id, position)
      VALUES (?, ?, ?, ?)
    `).run(list.id, mediaType, mediaId, getNextItemPosition(list.id));
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `"${mediaItem.title}" is already in this list` });
    }

    return res.status(500).json({ error: 'Unable to add item to list' });
  }

  touchList(list.id);
  const refreshedList = getListRecordById(list.id, req.user.id);
  res.status(201).json(buildListPayload(refreshedList, req.user.id));
});

router.delete('/:id/items/:itemId', (req, res) => {
  const list = requireEditableList(req, res);
  if (!list) return;

  const itemId = Number(req.params.itemId);
  const existingItem = db
    .prepare('SELECT id FROM media_list_items WHERE id = ? AND list_id = ?')
    .get(itemId, list.id);

  if (!existingItem) {
    return res.status(404).json({ error: 'List item not found' });
  }

  db.prepare('DELETE FROM media_list_items WHERE id = ? AND list_id = ?').run(itemId, list.id);
  normalizeItemPositions(list.id);
  touchList(list.id);

  const refreshedList = getListRecordById(list.id, req.user.id);
  res.json(buildListPayload(refreshedList, req.user.id));
});

router.patch('/:id/items/:itemId/move', (req, res) => {
  const list = requireEditableList(req, res);
  if (!list) return;

  const direction = req.body?.direction;
  if (!['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }

  const itemId = Number(req.params.itemId);
  const items = db
    .prepare('SELECT id, position FROM media_list_items WHERE list_id = ? ORDER BY position ASC, id ASC')
    .all(list.id);
  const currentIndex = items.findIndex((item) => Number(item.id) === itemId);

  if (currentIndex === -1) {
    return res.status(404).json({ error: 'List item not found' });
  }

  const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (swapIndex < 0 || swapIndex >= items.length) {
    const refreshedList = getListRecordById(list.id, req.user.id);
    return res.json(buildListPayload(refreshedList, req.user.id));
  }

  const reorderedItems = [...items];
  [reorderedItems[currentIndex], reorderedItems[swapIndex]] = [
    reorderedItems[swapIndex],
    reorderedItems[currentIndex],
  ];

  const updatePosition = db.prepare(
    'UPDATE media_list_items SET position = ? WHERE id = ? AND list_id = ?'
  );
  const transaction = db.transaction(() => {
    reorderedItems.forEach((item, index) => {
      updatePosition.run(index, item.id, list.id);
    });
  });

  transaction();
  touchList(list.id);

  const refreshedList = getListRecordById(list.id, req.user.id);
  res.json(buildListPayload(refreshedList, req.user.id));
});

router.post('/:id/items/:itemId/vote', (req, res) => {
  const list = requireEditableList(req, res);
  if (!list) return;

  const itemId = Number(req.params.itemId);
  const item = db
    .prepare('SELECT id FROM media_list_items WHERE id = ? AND list_id = ?')
    .get(itemId, list.id);

  if (!item) {
    return res.status(404).json({ error: 'List item not found' });
  }

  const voteValue = normalizeVoteValue(req.body?.value);
  if (voteValue == null) {
    return res.status(400).json({ error: 'Vote value must be 1, -1, or 0' });
  }

  if (voteValue === 0) {
    db.prepare(
      'DELETE FROM media_list_votes WHERE list_item_id = ? AND user_id = ?'
    ).run(item.id, req.user.id);
  } else {
    db.prepare(`
      INSERT INTO media_list_votes (list_item_id, user_id, value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(list_item_id, user_id) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(item.id, req.user.id, voteValue);
  }

  touchList(list.id);
  const refreshedList = getListRecordById(list.id, req.user.id);
  res.json(buildListPayload(refreshedList, req.user.id));
});

module.exports = router;
