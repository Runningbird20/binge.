// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom's default window is 1024x768 — the short side (768) sits exactly on
// useDeviceType's mobile breakpoint (isMobile: short <= 768), so components
// that branch on it render their mobile variant in tests. Bump to a size
// that's unambiguously desktop so tests keep exercising the desktop branch
// unless they explicitly resize the window themselves.
window.innerWidth = 1280;
window.innerHeight = 800;
