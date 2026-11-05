import { Link } from 'react-router-dom';
import { User } from '@phosphor-icons/react';
import HScroll from './HScroll';

// The title popup's cast & crew: a row of photos (‹ › to scroll, like the
// browse rows), director or creators first. Each opens that person's page
// with everything of theirs on binge.
export default function CastRow({ people }) {
  if (!people?.length) return null;
  return (
    <section className="td-cast" aria-label="Cast and crew">
      <h3 className="td-cast-title">Cast</h3>
      <HScroll as="ul" className="td-cast-list" label="cast and crew" deps={people}>
        {people.map((person) => (
          <li key={person.id}>
            <Link to={`/person/${person.id}`} className="td-cast-item" aria-label={person.role ? `${person.name}, ${person.role}` : person.name}>
              <span className="td-cast-photo">
                {person.photo
                  ? <img src={person.photo} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  : <User size={30} weight="bold" aria-hidden="true" />}
              </span>
              <span className="td-cast-name">{person.name}</span>
              {person.role && <span className="td-cast-role">{person.role}</span>}
            </Link>
          </li>
        ))}
      </HScroll>
    </section>
  );
}
