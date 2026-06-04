import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CHALLENGES_DIR = path.join(__dirname, 'challenges');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');

// Ensure base directories exist
if (!fs.existsSync(CHALLENGES_DIR)) {
  fs.mkdirSync(CHALLENGES_DIR, { recursive: true });
}
if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

// Helper to construct model prompts
function buildPrompt(prompt, existingCode) {
  if (!existingCode || existingCode.trim() === '') {
    return `Coding Task:\n${prompt}\n\nPlease output the solution clearly, including fully functional code and explanations where appropriate.`;
  }
  return `Coding Task:\n${prompt}\n\nHere is the existing code context you must work with:\n\`\`\`\n${existingCode}\n\`\`\`\n\nPlease output the updated solution clearly, highlighting the changes or providing the fully functional updated code with explanations.`;
}

// Helper to slugify challenge names
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '')             // Trim - from end of text
    .substring(0, 40)               // Cap length
    .replace(/-+$/, '');            // Trim - from end of text again in case substring split on a dash
}

// Helper to slugify model names
function slugifyModel(modelVal) {
  return modelVal.replace(/\//g, '_');
}

// Helper to extract first code block from markdown
function extractCodeBlock(markdown) {
  const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)\n```/;
  const match = markdown.match(codeBlockRegex);
  return match ? match[1] : markdown;
}

// Handler for calling OpenAI
async function callOpenAI(model, promptContent, apiKey, maxTokens) {
  if (!apiKey) throw new Error('OpenAI API Key is missing.');
  
  // Omit temperature for reasoning / GPT-5+ models (e.g. gpt-5.5, o1, o3)
  const isNewModel = /^(?:gpt-5|o[13])/i.test(model);

  const makeRequest = async (includeTemperature) => {
    const body = {
      model: model,
      messages: [
        { role: 'system', content: 'You are a world-class expert software engineer. Solve the programming task accurately, efficiently, and with premium code quality.' },
        { role: 'user', content: promptContent }
      ]
    };
    if (includeTemperature) {
      body.temperature = 0.2;
    }
    
    if (maxTokens && maxTokens !== 'default') {
      const tokensNum = parseInt(maxTokens, 10);
      if (!isNaN(tokensNum)) {
        if (isNewModel) {
          body.max_completion_tokens = tokensNum;
        } else {
          body.max_tokens = tokensNum;
        }
      }
    }
    
    return await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  };

  let response = await makeRequest(!isNewModel);

  if (!response.ok) {
    const err = await response.json();
    const errMsg = err.error?.message || response.statusText || '';
    // If we originally sent temperature and it failed because of temperature limitations, retry without it
    if (!isNewModel && response.status === 400 && errMsg.toLowerCase().includes('temperature')) {
      response = await makeRequest(false);
      if (!response.ok) {
        const retryErr = await response.json();
        throw new Error(`OpenAI Error: ${retryErr.error?.message || response.statusText}`);
      }
    } else {
      throw new Error(`OpenAI Error: ${errMsg}`);
    }
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Handler for calling Anthropic
async function callAnthropic(model, promptContent, apiKey, maxTokens) {
  if (!apiKey) throw new Error('Anthropic API Key is missing.');

  // Deprecated for Claude 4.7+ (e.g. claude-opus-4-7, claude-opus-4-8)
  const isNewModel = /claude-(?:opus|sonnet|haiku)-(\d+)[-.](\d+)/i.test(model) && (() => {
    const match = model.match(/claude-(?:opus|sonnet|haiku)-(\d+)[-.](\d+)/i);
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    return (major + (minor / 10)) >= 4.7;
  })();

  let resolvedMaxTokens = 4000;
  if (maxTokens && maxTokens !== 'default') {
    const tokensNum = parseInt(maxTokens, 10);
    if (!isNaN(tokensNum)) {
      resolvedMaxTokens = tokensNum;
    }
  }
  // Anthropic has a strict maximum output token limit of 8192 for the latest models.
  if (resolvedMaxTokens > 8192) {
    resolvedMaxTokens = 8192;
  }

  const makeRequest = async (includeTemperature) => {
    const body = {
      model: model,
      max_tokens: resolvedMaxTokens,
      messages: [
        { role: 'user', content: promptContent }
      ]
    };
    if (includeTemperature) {
      body.temperature = 0.2;
    }

    return await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
  };

  let response = await makeRequest(!isNewModel);

  if (!response.ok) {
    const err = await response.json();
    const errMsg = err.error?.message || response.statusText || '';
    // If we originally sent temperature and it failed because of temperature deprecation, retry without it
    if (!isNewModel && response.status === 400 && errMsg.toLowerCase().includes('temperature')) {
      response = await makeRequest(false);
      if (!response.ok) {
        const retryErr = await response.json();
        throw new Error(`Anthropic Error: ${retryErr.error?.message || response.statusText}`);
      }
    } else {
      throw new Error(`Anthropic Error: ${errMsg}`);
    }
  }

  const data = await response.json();
  return data.content[0].text;
}

// Handler for calling Gemini
async function callGemini(model, promptContent, apiKey, maxTokens) {
  if (!apiKey) throw new Error('Gemini API Key is missing.');

  const generationConfig = {
    temperature: 0.2
  };
  
  if (maxTokens && maxTokens !== 'default') {
    const tokensNum = parseInt(maxTokens, 10);
    if (!isNaN(tokensNum)) {
      generationConfig.maxOutputTokens = tokensNum;
    }
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: promptContent }
          ]
        }
      ],
      generationConfig: generationConfig
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Gemini Error: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Gemini returned no response candidates.');
  }
  return data.candidates[0].content.parts[0].text;
}

// Helper to resolve legacy/hypothetical model names to active, valid API IDs
function resolveModelName(provider, model) {
  if (provider === 'google' || provider === 'gemini') {
    if (model === 'gemini-3.1-pro') return 'gemini-3.1-pro-preview';
    if (model === 'gemini-2.1-pro') return 'gemini-2.5-pro';
  }
  return model;
}

// Route to generate code from a single model
async function executeModelCall(provider, model, promptContent, keys, maxTokens) {
  const resolvedModel = resolveModelName(provider, model);
  switch (provider) {
    case 'openai':
      return await callOpenAI(resolvedModel, promptContent, keys.openai, maxTokens);
    case 'anthropic':
      return await callAnthropic(resolvedModel, promptContent, keys.anthropic, maxTokens);
    case 'gemini':
    case 'google':
      return await callGemini(resolvedModel, promptContent, keys.gemini, maxTokens);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

// GET challenges list
app.get('/api/challenges', async (req, res) => {
  try {
    const folders = await fsPromises.readdir(CHALLENGES_DIR, { withFileTypes: true });
    const directories = folders.filter(f => f.isDirectory()).map(f => f.name);
    
    const challenges = [];
    for (const dir of directories) {
      const challengePath = path.join(CHALLENGES_DIR, dir);
      const promptPath = path.join(challengePath, 'prompt.md');
      
      let promptText = '';
      if (fs.existsSync(promptPath)) {
        promptText = await fsPromises.readFile(promptPath, 'utf-8');
      }
      
      // Look for code.[ext]
      const files = await fsPromises.readdir(challengePath);
      const codeFile = files.find(f => f.startsWith('code.'));
      
      let existingCode = '';
      if (codeFile) {
        existingCode = await fsPromises.readFile(path.join(challengePath, codeFile), 'utf-8');
      }
      
      // Check if outputs exist
      const outputDir = path.join(OUTPUTS_DIR, dir);
      let hasOutputs = false;
      
      const metaPath = path.join(outputDir, 'meta.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(await fsPromises.readFile(metaPath, 'utf-8'));
          const pathA = path.join(outputDir, `${meta.modelA.slug}.md`);
          const pathB = path.join(outputDir, `${meta.modelB.slug}.md`);
          hasOutputs = fs.existsSync(pathA) || fs.existsSync(pathB);
        } catch (e) {
          hasOutputs = false;
        }
      } else {
        hasOutputs = fs.existsSync(path.join(outputDir, 'model_a.md')) || 
                     fs.existsSync(path.join(outputDir, 'model_b.md'));
      }
      
      challenges.push({
        id: dir,
        prompt: promptText,
        existingCode: existingCode,
        existingCodeFile: codeFile || 'code.js',
        hasOutputs
      });
    }
    
    res.json({ challenges });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET saved outputs for a challenge
app.get('/api/outputs/:id', async (req, res) => {
  const challengeId = req.params.id;
  const challengeOutputDir = path.join(OUTPUTS_DIR, challengeId);
  const { modelA, modelB, judgeModel } = req.query;
  
  if (!fs.existsSync(challengeOutputDir)) {
    return res.status(404).json({ error: 'Outputs not found for this challenge.' });
  }
  
  try {
    const metaPath = path.join(challengeOutputDir, 'meta.json');
    let meta = null;
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(await fsPromises.readFile(metaPath, 'utf-8'));
      } catch (e) {
        // ignore parsing error
      }
    }

    // If specific models were requested, check each independently
    if (modelA || modelB) {
      const response = {
        modelA: '',
        modelB: '',
        modelAName: modelA ? (modelA.split('/')[1] || modelA) : 'Model A',
        modelBName: modelB ? (modelB.split('/')[1] || modelB) : 'Model B',
        modelAId: modelA || null,
        modelBId: modelB || null,
        modelAExists: false,
        modelBExists: false,
        judge: null
      };

      if (meta) {
        if (meta.modelA && meta.modelA.id === modelA) response.modelAName = meta.modelA.name;
        else if (meta.modelB && meta.modelB.id === modelA) response.modelAName = meta.modelB.name;
        
        if (meta.modelA && meta.modelA.id === modelB) response.modelBName = meta.modelA.name;
        else if (meta.modelB && meta.modelB.id === modelB) response.modelBName = meta.modelB.name;
      }

      if (modelA) {
        const modelASlug = slugifyModel(modelA);
        const pathA = path.join(challengeOutputDir, `${modelASlug}.md`);
        if (fs.existsSync(pathA)) {
          response.modelA = await fsPromises.readFile(pathA, 'utf-8');
          response.modelAExists = true;
        }
      }

      if (modelB) {
        const modelBSlug = slugifyModel(modelB);
        const pathB = path.join(challengeOutputDir, `${modelBSlug}.md`);
        if (fs.existsSync(pathB)) {
          response.modelB = await fsPromises.readFile(pathB, 'utf-8');
          response.modelBExists = true;
        }
      }

      let pathJudge = null;
      if (modelA && modelB && judgeModel) {
        const modelASlug = slugifyModel(modelA);
        const modelBSlug = slugifyModel(modelB);
        const judgeModelSlug = slugifyModel(judgeModel);
        const specificPath = path.join(challengeOutputDir, `judge_${modelASlug}_vs_${modelBSlug}_by_${judgeModelSlug}.md`);
        if (fs.existsSync(specificPath)) {
          pathJudge = specificPath;
        } else {
          // Fallback to legacy judge.md only if the models match the ones in meta.json
          if (meta && 
              ((meta.modelA.id === modelA && meta.modelB.id === modelB) ||
               (meta.modelA.id === modelB && meta.modelB.id === modelA))) {
            const legacyPath = path.join(challengeOutputDir, 'judge.md');
            if (fs.existsSync(legacyPath)) {
              pathJudge = legacyPath;
            }
          }
        }
      } else {
        pathJudge = path.join(challengeOutputDir, 'judge.md');
      }

      if (pathJudge && fs.existsSync(pathJudge)) {
        response.judge = await fsPromises.readFile(pathJudge, 'utf-8');
      }

      return res.json(response);
    }
    
    // Fallback if meta.json doesn't exist (backward compatibility)
    if (!meta) {
      const response = {
        modelA: '',
        modelB: '',
        modelAName: 'Model A',
        modelBName: 'Model B',
        judge: null
      };
      
      const pathA = path.join(challengeOutputDir, 'model_a.md');
      const pathB = path.join(challengeOutputDir, 'model_b.md');
      const pathJudge = path.join(challengeOutputDir, 'judge.md');
      
      if (fs.existsSync(pathA)) response.modelA = await fsPromises.readFile(pathA, 'utf-8');
      if (fs.existsSync(pathB)) response.modelB = await fsPromises.readFile(pathB, 'utf-8');
      if (fs.existsSync(pathJudge)) response.judge = await fsPromises.readFile(pathJudge, 'utf-8');
      
      return res.json(response);
    }
    
    // Load dynamically using meta.json
    const response = {
      modelA: '',
      modelB: '',
      modelAName: meta.modelA.name,
      modelBName: meta.modelB.name,
      modelAId: meta.modelA.id,
      modelBId: meta.modelB.id,
      modelAExists: true,
      modelBExists: true,
      judge: null
    };
    
    const pathA = path.join(challengeOutputDir, `${meta.modelA.slug}.md`);
    const pathB = path.join(challengeOutputDir, `${meta.modelB.slug}.md`);
    const pathJudge = path.join(challengeOutputDir, 'judge.md');
    
    if (fs.existsSync(pathA)) {
      response.modelA = await fsPromises.readFile(pathA, 'utf-8');
    }
    if (fs.existsSync(pathB)) {
      response.modelB = await fsPromises.readFile(pathB, 'utf-8');
    }
    if (fs.existsSync(pathJudge)) {
      response.judge = await fsPromises.readFile(pathJudge, 'utf-8');
    }
    
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Main generation endpoint (calls both models in parallel and logs files with slugs)
app.post('/api/compare', async (req, res) => {
  const { prompt, existingCode, existingCodeFile, challengeId, modelA, modelB, modelAName, modelBName, forceRegenerate, maxTokens } = req.body;
  const keys = {
    openai: req.headers['x-openai-key'],
    anthropic: req.headers['x-anthropic-key'],
    gemini: req.headers['x-gemini-key']
  };

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  // Determine/Create Challenge ID
  let resolvedChallengeId = challengeId ? slugify(challengeId) : '';
  if (!resolvedChallengeId) {
    resolvedChallengeId = slugify(prompt) || `challenge-${Date.now()}`;
  }

  // Create input folders
  const currentChallengeDir = path.join(CHALLENGES_DIR, resolvedChallengeId);
  if (!fs.existsSync(currentChallengeDir)) {
    await fsPromises.mkdir(currentChallengeDir, { recursive: true });
  }

  // Save Challenge files
  await fsPromises.writeFile(path.join(currentChallengeDir, 'prompt.md'), prompt, 'utf-8');
  
  const fileExt = path.extname(existingCodeFile || 'code.js') || '.js';
  const cleanCodeFile = existingCodeFile ? path.basename(existingCodeFile) : `code${fileExt}`;
  
  if (existingCode && existingCode.trim() !== '') {
    await fsPromises.writeFile(path.join(currentChallengeDir, cleanCodeFile), existingCode, 'utf-8');
  }

  const promptContent = buildPrompt(prompt, existingCode);

  const [providerA, realModelA] = modelA.split('/');
  const [providerB, realModelB] = modelB.split('/');

  const modelASlug = slugifyModel(modelA);
  const modelBSlug = slugifyModel(modelB);
  const currentOutputDir = path.join(OUTPUTS_DIR, resolvedChallengeId);

  const results = {
    modelA: { text: '', error: null },
    modelB: { text: '', error: null }
  };

  const pathA = path.join(currentOutputDir, `${modelASlug}.md`);
  const pathB = path.join(currentOutputDir, `${modelBSlug}.md`);
  const isForce = forceRegenerate === true || forceRegenerate === 'true';

  let cachedA = false;
  let cachedB = false;

  if (!isForce) {
    if (fs.existsSync(pathA)) {
      try {
        results.modelA.text = await fsPromises.readFile(pathA, 'utf-8');
        cachedA = true;
      } catch (err) {
        // Fallback to API if file read fails
      }
    }
    if (fs.existsSync(pathB)) {
      try {
        results.modelB.text = await fsPromises.readFile(pathB, 'utf-8');
        cachedB = true;
      } catch (err) {
        // Fallback to API if file read fails
      }
    }
  }

  // Run calls concurrently
  await Promise.all([
    (async () => {
      if (cachedA) return;
      try {
        results.modelA.text = await executeModelCall(providerA, realModelA, promptContent, keys, maxTokens);
      } catch (err) {
        results.modelA.error = err.message;
      }
    })(),
    (async () => {
      if (cachedB) return;
      try {
        results.modelB.text = await executeModelCall(providerB, realModelB, promptContent, keys, maxTokens);
      } catch (err) {
        results.modelB.error = err.message;
      }
    })()
  ]);

  // If no generation errors, save output files locally
  if (!results.modelA.error || !results.modelB.error) {
    if (!fs.existsSync(currentOutputDir)) {
      await fsPromises.mkdir(currentOutputDir, { recursive: true });
    }

    // Save outputs using model name slugs
    if (!results.modelA.error && !cachedA) {
      await fsPromises.writeFile(path.join(currentOutputDir, `${modelASlug}.md`), results.modelA.text, 'utf-8');
      const codeA = extractCodeBlock(results.modelA.text);
      await fsPromises.writeFile(path.join(currentOutputDir, `${modelASlug}${fileExt}`), codeA, 'utf-8');
    }

    if (!results.modelB.error && !cachedB) {
      await fsPromises.writeFile(path.join(currentOutputDir, `${modelBSlug}.md`), results.modelB.text, 'utf-8');
      const codeB = extractCodeBlock(results.modelB.text);
      await fsPromises.writeFile(path.join(currentOutputDir, `${modelBSlug}${fileExt}`), codeB, 'utf-8');
    }

    // Write meta.json
    const meta = {
      modelA: {
        id: modelA,
        slug: modelASlug,
        name: modelAName || realModelA
      },
      modelB: {
        id: modelB,
        slug: modelBSlug,
        name: modelBName || realModelB
      },
      fileExt
    };
    await fsPromises.writeFile(path.join(currentOutputDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  }

  res.json({
    challengeId: resolvedChallengeId,
    modelA: results.modelA,
    modelB: results.modelB,
    cached: cachedA && cachedB
  });
});

// AI Judge evaluation endpoint (runs judge and logs verdict file)
app.post('/api/judge', async (req, res) => {
  const { challengeId, prompt, existingCode, modelAName, modelBName, modelA, modelB, outputA, outputB, judgeModel, forceRegenerate, maxTokens } = req.body;
  const keys = {
    openai: req.headers['x-openai-key'],
    anthropic: req.headers['x-anthropic-key'],
    gemini: req.headers['x-gemini-key']
  };

  if (!prompt || !outputA || !outputB || !challengeId) {
    return res.status(400).json({ error: 'Missing required parameters for judging.' });
  }

  const currentOutputDir = path.join(OUTPUTS_DIR, challengeId);
  
  let filename = 'judge.md';
  if (modelA && modelB && judgeModel) {
    const modelASlug = slugifyModel(modelA);
    const modelBSlug = slugifyModel(modelB);
    const judgeModelSlug = slugifyModel(judgeModel);
    filename = `judge_${modelASlug}_vs_${modelBSlug}_by_${judgeModelSlug}.md`;
  }
  const pathJudge = path.join(currentOutputDir, filename);

  const isForce = forceRegenerate === true || forceRegenerate === 'true';

  if (!isForce && fs.existsSync(pathJudge)) {
    try {
      const evaluation = await fsPromises.readFile(pathJudge, 'utf-8');
      return res.json({ evaluation, cached: true });
    } catch (err) {
      // Fallback to API if file read fails
    }
  }

  const judgePrompt = `You are an expert, unbiased AI Code Judge. Your task is to compare two code outputs (Model A: ${modelAName} and Model B: ${modelBName}) created in response to a coding task (and optional existing code context), and decide which one is better and why.

Coding Task:
${prompt}

${existingCode ? `Existing Code Context:\n\`\`\`\n${existingCode}\n\`\`\`` : ''}

---
[MODEL A OUTPUT: ${modelAName}]
${outputA}

---
[MODEL B OUTPUT: ${modelBName}]
${outputB}

---
Evaluate the two outputs thoroughly based on:
1. Correctness: Does it solve the task correctly and handle edge cases?
2. Code Quality: Is the code clean, efficient, secure, and well-structured?
3. Explanations: Are the explanations clear, concise, and helpful?

Write your evaluation in a clean Markdown format. Give an in-depth scorecard showing pros/cons for both.
At the very end of your response, output a single JSON block inside a markdown code fence exactly like this:
\`\`\`json
{
  "winner": "Model A" | "Model B" | "Tie",
  "explanation": "Brief one sentence explanation of the choice."
}
\`\`\`
Do not include any text after the JSON code block.`;

  const [provider, realModel] = judgeModel.split('/');

  try {
    const evaluation = await executeModelCall(provider, realModel, judgePrompt, keys, maxTokens);
    
    // Save judge output locally
    if (!fs.existsSync(currentOutputDir)) {
      await fsPromises.mkdir(currentOutputDir, { recursive: true });
    }

    await fsPromises.writeFile(pathJudge, evaluation, 'utf-8');

    res.json({ evaluation, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET current aggregated summary
app.get('/api/aggregate', async (req, res) => {
  try {
    const summaryPath = path.join(__dirname, 'summarized-thoughts', 'README.md');
    let summary = '';
    if (fs.existsSync(summaryPath)) {
      summary = await fsPromises.readFile(summaryPath, 'utf-8');
    } else {
      summary = `# Summarized Thoughts & Model Comparisons\n\nNo aggregate summary available yet. Run the synthesis to compile results from the \`/outputs\` folder.\n`;
    }
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST to update aggregate opinions with new evaluations
app.post('/api/aggregate', async (req, res) => {
  const keys = {
    openai: req.headers['x-openai-key'],
    anthropic: req.headers['x-anthropic-key'],
    gemini: req.headers['x-gemini-key']
  };

  // We need at least one key to run the synthesis model
  const hasKey = keys.gemini || keys.openai || keys.anthropic;
  if (!hasKey) {
    return res.status(400).json({ error: 'At least one API Key (Gemini, OpenAI, or Anthropic) must be provided in your Settings to run the synthesis.' });
  }

  const SUMMARIZED_THOUGHTS_DIR = path.join(__dirname, 'summarized-thoughts');
  if (!fs.existsSync(SUMMARIZED_THOUGHTS_DIR)) {
    await fsPromises.mkdir(SUMMARIZED_THOUGHTS_DIR, { recursive: true });
  }

  const summaryPath = path.join(SUMMARIZED_THOUGHTS_DIR, 'README.md');
  const statePath = path.join(SUMMARIZED_THOUGHTS_DIR, 'aggregation-state.json');

  try {
    // 1. Load current summary
    let currentSummary = '';
    if (fs.existsSync(summaryPath)) {
      currentSummary = await fsPromises.readFile(summaryPath, 'utf-8');
    } else {
      currentSummary = `# Summarized Thoughts & Model Comparisons\n\nNo aggregate summary available yet.\n`;
    }

    // 2. Load aggregation state
    let state = { processedJudgments: {} };
    if (fs.existsSync(statePath)) {
      try {
        state = JSON.parse(await fsPromises.readFile(statePath, 'utf-8'));
      } catch (e) {
        state = { processedJudgments: {} };
      }
    }

    // 3. Scan outputs directory for judge reviews
    const folders = await fsPromises.readdir(OUTPUTS_DIR, { withFileTypes: true });
    const directories = folders.filter(f => f.isDirectory()).map(f => f.name);

    const newJudgments = [];

    for (const dir of directories) {
      const challengeOutputDir = path.join(OUTPUTS_DIR, dir);
      const files = await fsPromises.readdir(challengeOutputDir);

      // Find all judge files
      const judgeFiles = files.filter(f => f.startsWith('judge') && f.endsWith('.md'));

      for (const judgeFile of judgeFiles) {
        const filePath = path.join(challengeOutputDir, judgeFile);
        const content = await fsPromises.readFile(filePath, 'utf-8');

        // Use content length and file size as a simple hash/identifier
        const fileKey = `${dir}/${judgeFile}`;
        const stats = fs.statSync(filePath);
        const contentHash = `${content.length}-${stats.mtimeMs}`;

        const isNew = !state.processedJudgments[fileKey] || state.processedJudgments[fileKey].hash !== contentHash;

        if (isNew) {
          // Read challenge info if available to provide context to the LLM
          let target = 'Unknown coding task';
          let prompt = '';
          const challengePath = path.join(CHALLENGES_DIR, dir);
          if (fs.existsSync(challengePath)) {
            const criteriaPath = path.join(challengePath, 'criteria.md');
            if (fs.existsSync(criteriaPath)) {
              target = await fsPromises.readFile(criteriaPath, 'utf-8');
            }
            const promptPath = path.join(challengePath, 'prompt.md');
            if (fs.existsSync(promptPath)) {
              prompt = await fsPromises.readFile(promptPath, 'utf-8');
            }
          }

          newJudgments.push({
            fileKey,
            hash: contentHash,
            challengeId: dir,
            target,
            prompt,
            content
          });
        }
      }
    }

    // If no new judgments, return the current summary directly!
    if (newJudgments.length === 0) {
      return res.json({
        summary: currentSummary,
        updated: false,
        message: 'All comparison outputs are already aggregated. No new updates.'
      });
    }

    // 4. Run LLM update synthesis
    const systemPrompt = `You are a world-class principal software architect and AI evaluator. Your goal is to synthesize code evaluations from multiple LLMs across programming challenges to form an aggregate, high-fidelity opinion on each provider's top models.

We are comparing models from different providers (OpenAI, Anthropic, Gemini) side-by-side on specific coding challenges.

Your input consists of:
1. The current aggregated summary file (written in Markdown).
2. A list of NEW judge evaluations to incorporate.

Your task is to merge the new data into the existing Markdown document:
- Incorporate any new challenge evaluations into the "Tournament Tracking Log" table. Keep all pre-existing rows in the log.
- Synthesize the new feedback (errors, code qualities, strengths, weaknesses, tendencies, and how models performed on specific challenge types) and weave it into the "Aggregate Opinions & Synthesis" section for each provider's top models (Claude, Gemini, GPT).
- Refine the opinions as new evidence comes in, adjusting strengths/weaknesses and coding tendencies accordingly. Keep it objective, technical, and concrete.
- Do NOT rewrite the entire document from scratch. Maintain the structure, title, sections, Mermaid flowcharts, and formatting.
- Ensure the output is strictly valid Markdown. Do not wrap the Markdown block inside extra tags or write conversational text. Just output the final updated Markdown file content directly.`;

    const newJudgmentsFormatted = newJudgments.map((j, index) => {
      return `---
[NEW EVALUATION #${index + 1}]
File Key: ${j.fileKey}
Challenge: ${j.challengeId}
Challenge Target: ${j.target}
Prompt: ${j.prompt}

Judge Verdict Content:
${j.content}
`;
    }).join('\n\n');

    const promptContent = `Here is the current aggregated summary:
\`\`\`markdown
${currentSummary}
\`\`\`

Here are the new evaluations to aggregate:
${newJudgmentsFormatted}

Please output the fully updated Markdown file, incorporating all new evaluations and syntheses.`;

    let updatedSummary = '';

    // Choose model based on key availability
    if (keys.gemini) {
      updatedSummary = await callGemini('gemini-3.5-flash', `${systemPrompt}\n\n${promptContent}`, keys.gemini, '32000');
    } else if (keys.openai) {
      updatedSummary = await callOpenAI('gpt-4o', `${systemPrompt}\n\n${promptContent}`, keys.openai, '8000');
    } else if (keys.anthropic) {
      updatedSummary = await callAnthropic('claude-3-5-sonnet-20241022', `${systemPrompt}\n\n${promptContent}`, keys.anthropic, '8000');
    }

    // Clean up markdown block wraps if LLM returns them
    if (updatedSummary.startsWith('```markdown')) {
      updatedSummary = updatedSummary.slice(11);
      if (updatedSummary.endsWith('```')) {
        updatedSummary = updatedSummary.slice(0, -3);
      }
    } else if (updatedSummary.startsWith('```')) {
      updatedSummary = updatedSummary.slice(3);
      if (updatedSummary.endsWith('```')) {
        updatedSummary = updatedSummary.slice(0, -3);
      }
    }
    updatedSummary = updatedSummary.trim();

    // 5. Write the updated summary back to README.md
    await fsPromises.writeFile(summaryPath, updatedSummary, 'utf-8');

    // 6. Update the processed judgments state
    newJudgments.forEach(j => {
      state.processedJudgments[j.fileKey] = {
        processedAt: new Date().toISOString(),
        hash: j.hash
      };
    });

    await fsPromises.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');

    res.json({
      summary: updatedSummary,
      updated: true,
      message: `Successfully aggregated ${newJudgments.length} new evaluation(s) and updated the synthesis.`
    });

  } catch (err) {
    console.error('Error in aggregate endpoint:', err);
    res.status(500).json({ error: err.message });
  }
});

// Fallback to serving the main client index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
