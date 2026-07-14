// TEMP (UI preview only — do not commit): renders the real Movies/TVShows/Books
// pages with a mocked auth context so the redesign can be inspected without
// logging in.
import { useSearchParams } from 'react-router-dom';
import { __AuthContextForPreview as AuthContext } from '../contexts/AuthContext';
import Movies from './Movies';
import TVShows from './TVShows';
import Books from './Books';

const AUTH_VALUE = {
  user: { username: 'Cristal', avatarUrl: null, id: 'preview' },
  authLoading: false,
  login: async () => {},
  logout: async () => {},
  signup: async () => {},
};

export default function UIPreview() {
  const [searchParams] = useSearchParams();
  const page = searchParams.get('page') || 'movies';

  return (
    <AuthContext.Provider value={AUTH_VALUE}>
      {page === 'series' ? <TVShows /> : page === 'books' ? <Books /> : <Movies />}
    </AuthContext.Provider>
  );
}
