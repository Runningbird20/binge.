import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ThemedSelect from './ThemedSelect';
import {
  fetchSupabaseLists,
  addSupabaseListItem,
} from '../utils/supabaseData';

export default function ListSaveControls({ mediaType, mediaId, itemTitle }) {
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchLists() {
      setLoading(true);
      setMessage('');

      try {
const data = await fetchSupabaseLists();
        if (cancelled) return;

        const editableLists = Array.isArray(data)
          ? data.filter((list) => list?.permissions?.canEdit)
          : [];

        setLists(editableLists);
        setSelectedListId((current) => {
          if (current && editableLists.some((list) => String(list.id) === String(current))) {
            return current;
          }
          return editableLists[0] ? String(editableLists[0].id) : '';
        });
      } catch (error) {
        if (!cancelled) {
          setLists([]);
          setSelectedListId('');
          setMessage(error.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchLists();

    return () => {
      cancelled = true;
    };
  }, [mediaId, mediaType]);

  async function handleSaveToList() {
    if (!selectedListId) {
      setMessage('Create a list first so you can save this pick for later.');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const response = await addSupabaseListItem(selectedListId, {
        mediaType,
        mediaId,
      });

      const savedListName = response?.name || lists.find((list) => String(list.id) === selectedListId)?.name;
      setMessage(`Saved "${itemTitle}" to ${savedListName || 'your list'}.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="list-save-controls">
      <div className="list-save-controls-header">
        <span className="list-save-label">Save to a shared list</span>
        <Link to="/lists" className="list-save-manage-link">
          Manage lists
        </Link>
      </div>

      {loading ? (
        <p className="list-save-status">Loading your lists...</p>
      ) : lists.length === 0 ? (
        <p className="list-save-status">
          You do not have any editable lists yet. Visit <Link to="/lists">Lists</Link> to create one.
        </p>
      ) : (
        <div className="list-save-row">
          <ThemedSelect
            className="filter-input list-save-select"
            aria-label="Save to list"
            value={selectedListId}
            options={lists.map((list) => ({ value: list.id, label: list.name }))}
            onChange={(event) => setSelectedListId(event.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSaveToList}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Add to List'}
          </button>
        </div>
      )}

      {message && <p className="list-save-status">{message}</p>}
    </div>
  );
}
