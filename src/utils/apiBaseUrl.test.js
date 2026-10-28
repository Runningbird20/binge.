import { getApiBaseUrl } from './neon';

// Vercel had REACT_APP_API_URL=http://localhost:5001 copied from .env, which
// sent every catalog request on the deployed site to the visitor's machine.
describe('getApiBaseUrl', () => {
  const original = window.location;
  const env = process.env.REACT_APP_API_URL;
  const visit = (href) => { delete window.location; window.location = new URL(href); };
  afterEach(() => { window.location = original; process.env.REACT_APP_API_URL = env; });

  it('ignores a localhost API URL on a deployed site', () => {
    process.env.REACT_APP_API_URL = 'http://localhost:5001';
    visit('https://binge-26.vercel.app/movies');
    expect(getApiBaseUrl()).toBe('');
  });

  it('keeps a localhost API URL during local development', () => {
    process.env.REACT_APP_API_URL = 'http://localhost:5001/';
    visit('http://localhost:3000/movies');
    expect(getApiBaseUrl()).toBe('http://localhost:5001');
  });

  it('keeps a separately hosted API', () => {
    process.env.REACT_APP_API_URL = 'https://api.example.com';
    visit('https://binge-26.vercel.app/');
    expect(getApiBaseUrl()).toBe('https://api.example.com');
  });
});
