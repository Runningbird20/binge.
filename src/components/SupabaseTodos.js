import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../utils/supabase';

const INITIAL_STATE = {
  status: 'idle',
  todos: [],
  error: '',
};

export default function SupabaseTodos() {
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      return undefined;
    }

    if (!isSupabaseConfigured || !supabase) {
      setState({ status: 'disabled', todos: [], error: '' });
      return undefined;
    }

    let cancelled = false;

    async function loadTodos() {
      setState((current) => ({ ...current, status: 'loading', error: '' }));

      const { data, error } = await supabase
        .from('todos')
        .select('id, name')
        .order('id', { ascending: true })
        .limit(6);

      if (cancelled) {
        return;
      }

      if (error) {
        setState({ status: 'error', todos: [], error: error.message });
        return;
      }

      setState({ status: 'success', todos: data || [], error: '' });
    }

    loadTodos();

    return () => {
      cancelled = true;
    };
  }, []);

  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  if (state.status === 'disabled') {
    return (
      <div className="empty-state home-empty-card">
        <p>Supabase isn&apos;t configured yet.</p>
        <p className="empty-hint">
          Add your Supabase URL and publishable key to start reading from the
          public <code>todos</code> table.
        </p>
      </div>
    );
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="home-action-card">
        <p className="home-panel-copy">Connecting to Supabase and loading todos...</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="empty-state home-empty-card">
        <p>Supabase connected, but the todo query failed.</p>
        <p className="empty-hint">
          Make sure a readable <code>todos</code> table exists with <code>id</code> and
          <code> name</code> columns.
        </p>
        <p className="supabase-error-text">{state.error}</p>
      </div>
    );
  }

  if (state.todos.length === 0) {
    return (
      <div className="empty-state home-empty-card">
        <p>Your Supabase connection is working.</p>
        <p className="empty-hint">No rows were returned from the public <code>todos</code> table yet.</p>
      </div>
    );
  }

  return (
    <div className="home-action-card">
      <p className="home-panel-copy">
        Live data from Supabase. Showing the latest {state.todos.length} todo
        {state.todos.length === 1 ? '' : 's'} from the shared table.
      </p>
      <ul className="supabase-todo-list">
        {state.todos.map((todo) => (
          <li key={todo.id} className="supabase-todo-item">
            <span className="supabase-todo-bullet" aria-hidden="true" />
            <span>{todo.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
