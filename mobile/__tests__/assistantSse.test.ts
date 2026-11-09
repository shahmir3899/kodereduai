import { createSseParser } from '../services/assistantSse';
import { splitBlocks } from '../services/assistantRichText';

describe('SSE parser', () => {
  it('parses whole events', () => {
    const got: any[] = [];
    createSseParser((e) => got.push(e))('data: {"type":"start"}\n\ndata: {"type":"final","content":"hi"}\n\n');
    expect(got.map((e) => e.type)).toEqual(['start', 'final']);
  });

  it('keeps the tail of an event that is split across chunks', () => {
    const got: any[] = [];
    const parse = createSseParser((e) => got.push(e));
    parse('data: {"type":"ste');
    expect(got).toEqual([]);
    parse('p","index":1}\n');
    parse('\n');
    expect(got).toEqual([{ type: 'step', index: 1 }]);
  });

  it('handles CRLF line endings', () => {
    const got: any[] = [];
    createSseParser((e) => got.push(e))('data: {"type":"start"}\r\n\r\n');
    expect(got).toHaveLength(1);
  });

  it('skips a bad event without stopping the stream', () => {
    const got: any[] = [];
    createSseParser((e) => got.push(e))('data: {oops\n\n: comment\n\ndata: {"type":"final"}\n\n');
    expect(got).toEqual([{ type: 'final' }]);
  });
});

describe('rich text', () => {
  it('draws a markdown table as a table and keeps the rest as text', () => {
    const blocks = splitBlocks('Here:\n| Name | Due |\n|---|---|\n| Ali | 500 |\n| Sara | 0 |\nDone');
    expect(blocks.map((b) => b.type)).toEqual(['text', 'table', 'text']);
    expect(blocks[1]).toEqual({ type: 'table', head: ['Name', 'Due'], rows: [['Ali', '500'], ['Sara', '0']] });
  });

  it('leaves text without a table untouched', () => {
    expect(splitBlocks('just words')).toEqual([{ type: 'text', text: 'just words' }]);
  });
});
