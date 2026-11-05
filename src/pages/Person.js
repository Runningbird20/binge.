import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { User } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import TitleRow from '../components/TitleRow';
import { useAuth } from '../contexts/AuthContext';
import { maturityRestriction } from '../utils/kidsMode';
import { fetchPerson, lifeLine } from '../utils/people';

// An actor's or director's page (/person/:id): who they are, then their
// work that's on binge. as rows (opened from the cast photos in a title
// popup, or a person found by search). Titles follow the profile's maturity
// level and the release window, like every browse row.
export default function Person() {
  const { id } = useParams();
  const { activeProfile } = useAuth();
  const kidsSafe = maturityRestriction(activeProfile);
  const [state, setState] = useState({ status: 'loading' });
  const [bioOpen, setBioOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setBioOpen(false);
    fetchPerson(id, { kidsSafe })
      .then((result) => { if (!cancelled) setState(result ? { status: 'done', ...result } : { status: 'missing' }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [id, kidsSafe]);

  const { person, rows = [] } = state;
  const life = person ? lifeLine(person) : '';
  const longBio = (person?.biography || '').length > 420;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content person-page">
        {state.status === 'loading' && (
          <div className="person-head" aria-busy="true" aria-label="Loading">
            <span className="person-photo person-skel" />
            <div className="person-intro">
              <span className="person-skel person-skel-name" />
              <span className="person-skel person-skel-line" />
              <span className="person-skel person-skel-line" />
            </div>
          </div>
        )}

        {(state.status === 'missing' || state.status === 'error') && (
          <div className="pf-empty">
            <p>{state.status === 'missing' ? 'We couldn’t find that person.' : 'Couldn’t load this page. Check your connection and try again.'}</p>
            <Link to="/home" className="st-btn st-btn--ghost">Back to Home</Link>
          </div>
        )}

        {person && (
          <>
            <header className="person-head">
              <span className="person-photo">
                {person.photo ? <img src={person.photo} alt="" referrerPolicy="no-referrer" /> : <User size={56} weight="bold" aria-hidden="true" />}
              </span>
              <div className="person-intro">
                <h1 className="st-page-title">{person.name}</h1>
                {(person.department || life) && (
                  <p className="st-page-sub">{[person.department, life].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              {/* Beside the photo on wide screens, full width under it on phones. */}
              {person.biography && (
                <div className="person-about">
                  <p className={`person-bio${longBio && !bioOpen ? ' clamped' : ''}`}>{person.biography}</p>
                  {longBio && (
                    <button type="button" className="pf-link-btn person-bio-toggle" onClick={() => setBioOpen((open) => !open)} aria-expanded={bioOpen}>
                      {bioOpen ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}
            </header>

            {rows.length === 0 ? (
              <div className="pf-empty">
                <p>None of {person.name}’s work is on binge. yet.</p>
                <p className="td-muted">Search for a title instead, or check back later.</p>
              </div>
            ) : (
              <div className="st-rows person-rows">
                {rows.map((row) => <TitleRow key={row.id} title={row.title} items={row.items} />)}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
