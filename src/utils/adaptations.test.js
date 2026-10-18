import { splitBookTitle } from './adaptations';

jest.mock('./supabase', () => ({ requireSupabaseClient: jest.fn() }));
jest.mock('./catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));

describe('splitBookTitle', () => {
  it('separates Goodreads series info from the title', () => {
    expect(splitBookTitle('Dune (Dune, #1)')).toEqual({ main: 'Dune', series: 'Dune', number: 1 });
    expect(splitBookTitle('Children of Dune (Dune #3)')).toEqual({ main: 'Children of Dune', series: 'Dune', number: 3 });
    expect(splitBookTitle('A Game of Thrones (A Song of Ice and Fire, #1)')).toEqual({ main: 'A Game of Thrones', series: 'A Song of Ice and Fire', number: 1 });
  });

  it('leaves standalone titles alone', () => {
    expect(splitBookTitle('The Martian')).toEqual({ main: 'The Martian', series: '', number: null });
    expect(splitBookTitle('Fire & Blood (Targaryen History)')).toEqual({ main: 'Fire & Blood (Targaryen History)', series: '', number: null });
  });
});
