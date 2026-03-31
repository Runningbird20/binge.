import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

beforeAll(() => {
  class MockFileReader {
    readAsDataURL(file) {
      this.result = `data:${file.type};base64,avatar-preview`;

      if (this.onload) {
        this.onload({ target: this });
      }
    }
  }

  global.FileReader = MockFileReader;
});

test('renders the auth header with login and sign up options', () => {
  render(<App />);

  expect(
    screen.getByRole('button', { name: /log in/i })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /sign up/i })
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByRole('heading', { name: /create your profile/i })
  ).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
});

test('shows the login placeholder when login is selected', async () => {
  render(<App />);

  await userEvent.click(screen.getByRole('button', { name: /log in/i }));

  expect(
    screen.getByRole('heading', { name: /log in will live here/i })
  ).toBeInTheDocument();
  expect(screen.getByText(/login is not built yet/i)).toBeInTheDocument();
});

test('uses an uploaded photo as the avatar preview', async () => {
  render(<App />);

  const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText(/upload avatar photo/i), file);

  expect(screen.getByText(/avatar\.png selected for your avatar/i)).toBeInTheDocument();

  const preview = await screen.findByRole('img', { name: /avatar preview/i });
  expect(preview).toHaveAttribute('src', 'data:image/png;base64,avatar-preview');
});

test('creates a local profile from sign up', async () => {
  render(<App />);

  await userEvent.type(screen.getByLabelText(/username/i), 'mediafan');
  await userEvent.type(
    screen.getByLabelText(/bio/i),
    'I keep a short list of everything I finish.'
  );
  await userEvent.type(
    screen.getByLabelText(/password/i),
    'secretpass123'
  );
  await userEvent.click(screen.getByRole('button', { name: /create profile/i }));

  expect(screen.getByRole('heading', { name: /@mediafan/i })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/profile created locally/i);
});
