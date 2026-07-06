import { describe, expect, it } from 'vitest';
import { brandFromNamespace, prettyName } from '../src/names.js';

describe('brandFromNamespace', () => {
  it('extracts the brand segment from reverse-DNS ids', () => {
    expect(brandFromNamespace('ai.gomarble/mcp-api')).toBe('gomarble');
    expect(brandFromNamespace('com.stripe/mcp')).toBe('stripe');
    expect(brandFromNamespace('io.github.microsoft/playwright-mcp')).toBe('microsoft');
    expect(brandFromNamespace('agency.lona/trading')).toBe('lona');
  });
});

describe('prettyName', () => {
  it('recovers the real brand from the description', () => {
    // The user's case: no title, brand only in the description.
    expect(prettyName('ai.gomarble/mcp-api', undefined, 'GoMarble MCP API Server')).toBe('GoMarble');
    // Even a misleading generic title loses to the real name in the description.
    expect(prettyName('ai.gomarble/mcp-api', 'AI Marketing Agency', 'GoMarble MCP API Server')).toBe(
      'GoMarble',
    );
  });

  it('uses a single proper-noun description lead', () => {
    expect(prettyName('io.github.microsoft/playwright-mcp', undefined, 'Playwright MCP server')).toBe(
      'Playwright',
    );
    expect(prettyName('ac.tandem/docs-mcp', undefined, 'Tandem docs search')).toBe('Tandem');
  });

  it('does not grab a sentence that merely starts with a capital/verb', () => {
    expect(prettyName('ac.inference.sh/mcp', 'inference.sh', 'Run 150+ AI apps')).toBe('inference.sh');
    expect(prettyName('io.github.foo/weather-bot', undefined, 'Get the weather anywhere')).toBe(
      'Weather Bot',
    );
  });

  it('trims boilerplate from a title', () => {
    expect(prettyName('ai.adadvisor/mcp-server', 'AdAdvisor MCP Server', 'x')).toBe('AdAdvisor');
    expect(prettyName('ai.abmeter/abmeter', 'ABMeter', 'ABMeter measures ads')).toBe('ABMeter');
  });

  it('falls back to a title-cased brand when nothing else is usable', () => {
    expect(prettyName('com.stripe/mcp', undefined, '')).toBe('Stripe');
  });
});
