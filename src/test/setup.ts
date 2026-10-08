import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock window.scrollTo for jsdom
window.scrollTo = vi.fn();
