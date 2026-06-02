import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const htmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
const appJsContent = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf-8');

describe('CodeArena Frontend Tests', () => {
  let dom;
  let window;
  let document;
  let mockFetch;

  // Helper to wait for all pending promises/microtasks to complete
  const flushPromises = () => new Promise(resolve => setTimeout(resolve, 10));

  // Common challenges list response
  const getChallengesListResponse = () => ({
    ok: true,
    json: () => Promise.resolve({
      challenges: [
        {
          id: "fibonacci",
          prompt: "Write fibonacci sequence in JS",
          existingCode: "function fib() {}",
          existingCodeFile: "code.js",
          hasOutputs: true
        },
        {
          id: "frontier-exp-claude-logic",
          prompt: "Write some Claude logic",
          existingCode: "",
          existingCodeFile: "code.js",
          hasOutputs: false
        }
      ]
    })
  });

  beforeEach(() => {
    // Set up a clean JSDOM environment for each test with url to enable localStorage
    dom = new JSDOM(htmlContent, { runScripts: "outside-only", url: "http://localhost" });
    window = dom.window;
    document = window.document;

    // Polyfill localStorage to prevent opaque origin errors in JSDOM environments
    const mockLocalStorage = (() => {
      let store = {};
      return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
      };
    })();
    Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, writable: true });

    // Mock window global dependencies
    window.alert = vi.fn();
    window.marked = {
      parse: (text) => `<div>Parsed: ${text}</div>`,
      parseInline: (text) => text,
      use: vi.fn()
    };
    window.hljs = {
      highlightElement: vi.fn()
    };
    // Mock navigator.clipboard
    window.navigator.clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined)
    };

    // Default mock implementation for fetch
    mockFetch = vi.fn().mockImplementation((url, options) => {
      if (url === '/api/challenges') {
        return Promise.resolve(getChallengesListResponse());
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Not found' })
      });
    });

    window.fetch = mockFetch;

    // Evaluate app.js in the window context
    window.eval(appJsContent);

    // Dispatch DOMContentLoaded to trigger app.js initialization
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  });

  it('should initialize with correct default state', async () => {
    await flushPromises();

    const challengeSelect = document.getElementById('challengeSelect');
    expect(challengeSelect.value).toBe('new');

    const comparisonWorkspace = document.getElementById('comparisonWorkspace');
    expect(comparisonWorkspace.classList.contains('hidden')).toBe(true);

    const judgePlaceholder = document.getElementById('judgePlaceholder');
    expect(judgePlaceholder.classList.contains('hidden')).toBe(false);

    const runJudgeBtn = document.getElementById('runJudgeBtn');
    expect(runJudgeBtn.disabled).toBe(true);
  });

  describe('Scenario 1: Selecting a challenge with saved outputs (Positive Case)', () => {
    it('should fetch metadata, update model selections, and display saved outputs and judge scorecard', async () => {
      await flushPromises();

      // Configure fetch mocks (using actual option values present in index.html)
      mockFetch.mockImplementation(async (url) => {
        if (url === '/api/challenges') {
          return getChallengesListResponse();
        }
        if (url === '/api/outputs/fibonacci') {
          return {
            ok: true,
            json: () => Promise.resolve({
              modelAId: 'anthropic/claude-opus-4-8',
              modelBId: 'google/gemini-3.5-flash'
            })
          };
        }
        if (url.startsWith('/api/outputs/fibonacci?')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              modelAExists: true,
              modelBExists: true,
              modelA: 'Saved Claude Code',
              modelB: 'Saved Gemini Code',
              judge: '### Evaluation Scorecard\n```json\n{"winner": "Model A", "explanation": "Clean code."}\n```'
            })
          };
        }
        return { ok: false, status: 404 };
      });

      const challengeSelect = document.getElementById('challengeSelect');
      challengeSelect.value = 'fibonacci';
      challengeSelect.dispatchEvent(new window.Event('change'));

      await flushPromises();

      const modelA = document.getElementById('modelA');
      const modelB = document.getElementById('modelB');

      // Verify dropdown values updated
      expect(modelA.value).toBe('anthropic/claude-opus-4-8');
      expect(modelB.value).toBe('google/gemini-3.5-flash');

      // Verify outputs loaded and visible
      const comparisonWorkspace = document.getElementById('comparisonWorkspace');
      expect(comparisonWorkspace.classList.contains('hidden')).toBe(false);

      const contentA = document.getElementById('contentA');
      const contentB = document.getElementById('contentB');
      expect(contentA.classList.contains('hidden')).toBe(false);
      expect(contentB.classList.contains('hidden')).toBe(false);
      expect(contentA.innerHTML).toContain('Saved Claude Code');
      expect(contentB.innerHTML).toContain('Saved Gemini Code');

      // Verify "Saved" appended to headers
      const labelModelA = document.getElementById('labelModelA');
      const labelModelB = document.getElementById('labelModelB');
      expect(labelModelA.textContent).toContain('(Saved)');
      expect(labelModelB.textContent).toContain('(Saved)');

      // Verify judge results shown
      const judgeResults = document.getElementById('judgeResults');
      expect(judgeResults.classList.contains('hidden')).toBe(false);
      const judgeWinner = document.getElementById('judgeWinner');
      expect(judgeWinner.textContent).toBe('Model A Wins');
      expect(document.getElementById('judgePlaceholder').classList.contains('hidden')).toBe(true);
    });
  });

  describe('Scenario 2: Selecting a challenge with NO saved outputs (Negative Case)', () => {
    it('should reset the workspace columns and show empty/error state when switching from a saved challenge to a non-saved challenge', async () => {
      await flushPromises();

      // Start by loading a saved challenge (fibonacci)
      mockFetch.mockImplementation(async (url) => {
        if (url === '/api/challenges') {
          return getChallengesListResponse();
        }
        if (url === '/api/outputs/fibonacci') {
          return {
            ok: true,
            json: () => Promise.resolve({
              modelAId: 'anthropic/claude-opus-4-8',
              modelBId: 'google/gemini-3.5-flash'
            })
          };
        }
        if (url.startsWith('/api/outputs/fibonacci?')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              modelAExists: true,
              modelBExists: true,
              modelA: 'Saved Claude Code',
              modelB: 'Saved Gemini Code',
              judge: '```json\n{"winner": "Model A"}\n```'
            })
          };
        }
        return { ok: false, status: 404 };
      });

      const challengeSelect = document.getElementById('challengeSelect');
      challengeSelect.value = 'fibonacci';
      challengeSelect.dispatchEvent(new window.Event('change'));
      await flushPromises();

      // Ensure fibonacci outputs are visible
      expect(document.getElementById('contentA').classList.contains('hidden')).toBe(false);

      // Switch mock to return 404 for the next challenge (frontier-exp-claude-logic)
      mockFetch.mockImplementation(async (url) => {
        if (url === '/api/challenges') {
          return getChallengesListResponse();
        }
        if (url.startsWith('/api/outputs/frontier-exp-claude-logic')) {
          return { ok: false, status: 404 };
        }
        return { ok: false, status: 404 };
      });

      challengeSelect.value = 'frontier-exp-claude-logic';
      challengeSelect.dispatchEvent(new window.Event('change'));
      await flushPromises();

      // Verify columns have been reset and show "No saved output" messages
      const contentA = document.getElementById('contentA');
      const contentB = document.getElementById('contentB');
      const errorA = document.getElementById('errorA');
      const errorB = document.getElementById('errorB');

      expect(contentA.classList.contains('hidden')).toBe(true);
      expect(contentB.classList.contains('hidden')).toBe(true);
      expect(errorA.classList.contains('hidden')).toBe(false);
      expect(errorB.classList.contains('hidden')).toBe(false);
      expect(errorA.textContent).toContain('No saved output for');

      // Verify judge results and run buttons are reset
      expect(document.getElementById('judgePlaceholder').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('judgeResults').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('runJudgeBtn').disabled).toBe(true);
    });
  });

  describe('Scenario 3: Changing Selected Models', () => {
    it('should correctly reload outputs when selected models are changed', async () => {
      await flushPromises();

      // Set initial saved outputs for Claude and Gemini
      mockFetch.mockImplementation(async (url) => {
        if (url === '/api/challenges') {
          return getChallengesListResponse();
        }
        if (url === '/api/outputs/fibonacci') {
          return {
            ok: true,
            json: () => Promise.resolve({
              modelAId: 'anthropic/claude-opus-4-8',
              modelBId: 'google/gemini-3.5-flash'
            })
          };
        }
        if (url.startsWith('/api/outputs/fibonacci?')) {
          // Model A = Claude, Model B = Gemini
          if (url.includes('anthropic%2Fclaude-opus-4-8') && url.includes('google%2Fgemini-3.5-flash')) {
            return {
              ok: true,
              json: () => Promise.resolve({
                modelAExists: true,
                modelBExists: true,
                modelA: 'Claude code text',
                modelB: 'Gemini code text'
              })
            };
          }
          // If we change Model A to GPT-4o, it does not exist
          if (url.includes('openai%2Fgpt-4o') && url.includes('google%2Fgemini-3.5-flash')) {
            return {
              ok: true,
              json: () => Promise.resolve({
                modelAExists: false,
                modelBExists: true,
                modelB: 'Gemini code text'
              })
            };
          }
        }
        return { ok: false, status: 404 };
      });

      // Select fibonacci
      const challengeSelect = document.getElementById('challengeSelect');
      challengeSelect.value = 'fibonacci';
      challengeSelect.dispatchEvent(new window.Event('change'));
      await flushPromises();

      // Check initially both are showing
      expect(document.getElementById('contentA').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('contentA').innerHTML).toContain('Claude code text');

      // Change Model A to GPT-4o
      const modelA = document.getElementById('modelA');
      modelA.value = 'openai/gpt-4o';
      modelA.dispatchEvent(new window.Event('change'));
      await flushPromises();

      // Model A output should be hidden and error shown, Model B should remain visible
      expect(document.getElementById('contentA').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('errorA').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('errorA').textContent).toContain('No saved output for');

      expect(document.getElementById('contentB').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('contentB').innerHTML).toContain('Gemini code text');
    });
  });

  describe('Scenario 4: Successful API Generation (Positive Case)', () => {
    it('should invoke generate API, hide loading spinners, remove hidden classes, and render generated content immediately', async () => {
      await flushPromises();

      // Set mock for compare API call
      mockFetch.mockImplementation(async (url, options) => {
        if (url === '/api/challenges') {
          return getChallengesListResponse();
        }
        if (url === '/api/compare' && options.method === 'POST') {
          return {
            ok: true,
            json: () => Promise.resolve({
              challengeId: 'frontier-exp-claude-logic',
              modelA: { text: 'New live Claude response' },
              modelB: { text: 'New live Gemini response' }
            })
          };
        }
        return { ok: false, status: 404 };
      });

      // Ensure API keys are present in LocalStorage
      window.localStorage.setItem('code_arena_openai_key', 'test-key');
      window.localStorage.setItem('code_arena_anthropic_key', 'test-key');
      window.localStorage.setItem('code_arena_gemini_key', 'test-key');

      // Select frontier challenge (has no outputs)
      const challengeSelect = document.getElementById('challengeSelect');
      challengeSelect.value = 'frontier-exp-claude-logic';
      challengeSelect.dispatchEvent(new window.Event('change'));
      await flushPromises();

      const taskPrompt = document.getElementById('taskPrompt');
      taskPrompt.value = 'Implement a quicksort algorithm';

      const generateBtn = document.getElementById('generateBtn');
      generateBtn.dispatchEvent(new window.Event('click'));

      // Check loading indicators are shown during generation
      expect(document.getElementById('loadingA').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('loadingB').classList.contains('hidden')).toBe(false);

      await flushPromises();

      // Verify loading is hidden and content is shown and loaded
      expect(document.getElementById('loadingA').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('loadingB').classList.contains('hidden')).toBe(true);

      const contentA = document.getElementById('contentA');
      const contentB = document.getElementById('contentB');
      expect(contentA.classList.contains('hidden')).toBe(false);
      expect(contentB.classList.contains('hidden')).toBe(false);
      expect(contentA.innerHTML).toContain('New live Claude response');
      expect(contentB.innerHTML).toContain('New live Gemini response');

      // Verify saved labels
      expect(document.getElementById('labelModelA').textContent).toContain('(Saved)');
      expect(document.getElementById('labelModelB').textContent).toContain('(Saved)');
    });
  });

  describe('Scenario 5: Failed API Generation (Negative Case)', () => {
    it('should render error messages and hide content when compare API returns errors for a model', async () => {
      await flushPromises();

      mockFetch.mockImplementation(async (url, options) => {
        if (url === '/api/challenges') {
          return getChallengesListResponse();
        }
        if (url === '/api/compare' && options.method === 'POST') {
          return {
            ok: true,
            json: () => Promise.resolve({
              challengeId: 'frontier-exp-claude-logic',
              modelA: { error: 'Rate limit exceeded on provider' },
              modelB: { text: 'Succeeded Gemini response' }
            })
          };
        }
        return { ok: false, status: 404 };
      });

      window.localStorage.setItem('code_arena_openai_key', 'test-key');
      window.localStorage.setItem('code_arena_anthropic_key', 'test-key');
      window.localStorage.setItem('code_arena_gemini_key', 'test-key');

      const challengeSelect = document.getElementById('challengeSelect');
      challengeSelect.value = 'frontier-exp-claude-logic';
      challengeSelect.dispatchEvent(new window.Event('change'));
      await flushPromises();

      document.getElementById('taskPrompt').value = 'Test prompt';
      document.getElementById('generateBtn').dispatchEvent(new window.Event('click'));

      await flushPromises();

      // Model A failed
      expect(document.getElementById('contentA').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('errorA').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('errorA').textContent).toBe('Rate limit exceeded on provider');

      // Model B succeeded
      expect(document.getElementById('contentB').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('errorB').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('contentB').innerHTML).toContain('Succeeded Gemini response');
    });
  });

  describe('Scenario 6: Dynamic AI Judge Selection and Rendering', () => {
    it('should query with judgeModel parameter and reload judge scorecard when judge model changes', async () => {
      await flushPromises();

      // Configure fetch mocks
      mockFetch.mockImplementation(async (url, options) => {
        if (url === '/api/challenges') {
          return getChallengesListResponse();
        }
        if (url === '/api/outputs/fibonacci') {
          return {
            ok: true,
            json: () => Promise.resolve({
              modelAId: 'anthropic/claude-opus-4-8',
              modelBId: 'google/gemini-3.5-flash'
            })
          };
        }
        if (url.startsWith('/api/outputs/fibonacci?')) {
          // If judgeModel is Gemini 3.1 Pro (default selected in HTML is google/gemini-3.1-pro)
          if (url.includes('judgeModel=google%2Fgemini-3.1-pro')) {
            return {
              ok: true,
              json: () => Promise.resolve({
                modelAExists: true,
                modelBExists: true,
                modelA: 'Saved Claude Code',
                modelB: 'Saved Gemini Code',
                judge: '### Gemini evaluation\n```json\n{"winner": "Model A", "explanation": "Gemini selected Claude."}\n```'
              })
            };
          }
          // If judgeModel is changed to openai/gpt-5.5
          if (url.includes('judgeModel=openai%2Fgpt-5.5')) {
            return {
              ok: true,
              json: () => Promise.resolve({
                modelAExists: true,
                modelBExists: true,
                modelA: 'Saved Claude Code',
                modelB: 'Saved Gemini Code',
                judge: '### OpenAI evaluation\n```json\n{"winner": "Model B", "explanation": "OpenAI selected Gemini."}\n```'
              })
            };
          }
        }
        return { ok: false, status: 404 };
      });

      // Select fibonacci challenge
      const challengeSelect = document.getElementById('challengeSelect');
      challengeSelect.value = 'fibonacci';
      challengeSelect.dispatchEvent(new window.Event('change'));
      await flushPromises();

      // Verify dropdown values updated
      const modelA = document.getElementById('modelA');
      const modelB = document.getElementById('modelB');
      expect(modelA.value).toBe('anthropic/claude-opus-4-8');
      expect(modelB.value).toBe('google/gemini-3.5-flash');

      // Verify the first fetch URL included the default judgeModel
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('judgeModel=google%2Fgemini-3.1-pro')
      );

      // Verify Gemini's scorecard is rendered
      const judgeWinner = document.getElementById('judgeWinner');
      expect(judgeWinner.textContent).toBe('Model A Wins');
      expect(document.getElementById('judgeShortExplanation').textContent).toBe('Gemini selected Claude.');

      // Now change the Judge Model to OpenAI GPT-5.5
      const judgeModel = document.getElementById('judgeModel');
      judgeModel.value = 'openai/gpt-5.5';
      judgeModel.dispatchEvent(new window.Event('change'));
      await flushPromises();

      // Verify the new fetch URL included the new judgeModel
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('judgeModel=openai%2Fgpt-5.5')
      );

      // Verify OpenAI's scorecard is rendered (Model B wins)
      expect(judgeWinner.textContent).toBe('Model B Wins');
      expect(document.getElementById('judgeShortExplanation').textContent).toBe('OpenAI selected Gemini.');
    });
  });

  describe('Scenario 7: Judge Output Caching Toggle', () => {
    it('should pass forceRegenerate based on the checkbox selection in judge execution requests', async () => {
      await flushPromises();

      // Configure fetch mocks
      mockFetch.mockImplementation(async (url, options) => {
        if (url === '/api/challenges') {
          return getChallengesListResponse();
        }
        if (url === '/api/outputs/fibonacci') {
          return {
            ok: true,
            json: () => Promise.resolve({
              modelAId: 'anthropic/claude-opus-4-8',
              modelBId: 'google/gemini-3.5-flash'
            })
          };
        }
        if (url.startsWith('/api/outputs/fibonacci?')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              modelAExists: true,
              modelBExists: true,
              modelA: 'Saved Claude Code',
              modelB: 'Saved Gemini Code'
            })
          };
        }
        if (url === '/api/judge' && options.method === 'POST') {
          return {
            ok: true,
            json: () => Promise.resolve({
              evaluation: '### Cached or Fresh Scorecard\n```json\n{"winner": "Tie", "explanation": "Checked forceRegenerate."}\n```'
            })
          };
        }
        return { ok: false, status: 404 };
      });

      // Ensure keys are set
      window.localStorage.setItem('code_arena_openai_key', 'test-key');
      window.localStorage.setItem('code_arena_anthropic_key', 'test-key');
      window.localStorage.setItem('code_arena_gemini_key', 'test-key');

      // Select fibonacci challenge
      const challengeSelect = document.getElementById('challengeSelect');
      challengeSelect.value = 'fibonacci';
      challengeSelect.dispatchEvent(new window.Event('change'));
      await flushPromises();

      // 1. Run judge with forceRegenerate = false (default)
      const forceRegenerate = document.getElementById('forceRegenerate');
      forceRegenerate.checked = false;

      const runJudgeBtn = document.getElementById('runJudgeBtn');
      runJudgeBtn.dispatchEvent(new window.Event('click'));
      await flushPromises();

      // Verify the POST body had forceRegenerate: false
      const firstJudgeCall = mockFetch.mock.calls.find(call => call[0] === '/api/judge');
      expect(firstJudgeCall).toBeDefined();
      const firstBody = JSON.parse(firstJudgeCall[1].body);
      expect(firstBody.forceRegenerate).toBe(false);

      // Reset mock fetch calls tracker
      mockFetch.mockClear();

      // 2. Run judge with forceRegenerate = true
      forceRegenerate.checked = true;
      runJudgeBtn.disabled = false; // Re-enable for test purposes as it gets disabled on successful render
      runJudgeBtn.dispatchEvent(new window.Event('click'));
      await flushPromises();

      // Verify the POST body had forceRegenerate: true
      const secondJudgeCall = mockFetch.mock.calls.find(call => call[0] === '/api/judge');
      expect(secondJudgeCall).toBeDefined();
      const secondBody = JSON.parse(secondJudgeCall[1].body);
      expect(secondBody.forceRegenerate).toBe(true);
    });
  });
});
