import { describe, expect, it } from 'vitest';
import vercelHandler from '../src/app';

describe('Vercel entrypoint', () => {
  it('exports a default HTTP handler', () => {
    expect(vercelHandler).toBeTypeOf('function');
  });
});
