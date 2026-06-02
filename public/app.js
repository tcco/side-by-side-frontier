document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const settingsOverlay = document.getElementById('settingsOverlay');
  
  const keyOpenAI = document.getElementById('keyOpenAI');
  const keyAnthropic = document.getElementById('keyAnthropic');
  const keyGemini = document.getElementById('keyGemini');
  
  const toggleExistingCode = document.getElementById('toggleExistingCode');
  const existingCodeWrapper = document.getElementById('existingCodeWrapper');
  const taskPrompt = document.getElementById('taskPrompt');
  const existingCode = document.getElementById('existingCode');
  const existingCodeFile = document.getElementById('existingCodeFile');
  const codeExtIndicator = document.getElementById('codeExtIndicator');
  
  const challengeSelect = document.getElementById('challengeSelect');
  const newChallengeGroup = document.getElementById('newChallengeGroup');
  const newChallengeName = document.getElementById('newChallengeName');
  
  const modelA = document.getElementById('modelA');
  const modelB = document.getElementById('modelB');
  const generateBtn = document.getElementById('generateBtn');
  
  const comparisonWorkspace = document.getElementById('comparisonWorkspace');
  const storageNotice = document.getElementById('storageNotice');
  const runJudgeBtn = document.getElementById('runJudgeBtn');
  
  const labelModelA = document.getElementById('labelModelA');
  const labelModelB = document.getElementById('labelModelB');
  
  const loadingA = document.getElementById('loadingA');
  const loadingB = document.getElementById('loadingB');
  const errorA = document.getElementById('errorA');
  const errorB = document.getElementById('errorB');
  const contentA = document.getElementById('contentA');
  const contentB = document.getElementById('contentB');
  
  const judgeSection = document.getElementById('judgeSection');
  const judgeModel = document.getElementById('judgeModel');
  const judgeLoading = document.getElementById('judgeLoading');
  const judgeError = document.getElementById('judgeError');
  const judgeResults = document.getElementById('judgeResults');
  const judgeWinner = document.getElementById('judgeWinner');
  const judgeShortExplanation = document.getElementById('judgeShortExplanation');
  const judgeContent = document.getElementById('judgeContent');
  const judgeVerdictBanner = document.getElementById('judgeVerdictBanner');

  // Relocated / New DOM Elements
  const forceRegenerate = document.getElementById('forceRegenerate');
  const autoRunJudge = document.getElementById('autoRunJudge');
  const judgePlaceholder = document.getElementById('judgePlaceholder');

  // Cache for loaded challenges
  let challengesCache = [];
  
  // Cache to store the currently active outputs for the judge
  let activeSession = {
    challengeId: '',
    outputA: '',
    outputB: '',
    prompt: '',
    existingCode: '',
    modelAName: '',
    modelBName: ''
  };

  // Initialize
  loadApiKeys();
  refreshChallengesList();

  // Sync existing code file input with the trigger extension indicator badge
  existingCodeFile.addEventListener('input', () => {
    const val = existingCodeFile.value.trim();
    codeExtIndicator.textContent = val ? val : 'code.js';
  });

  // Collapsible existing code context logic
  toggleExistingCode.addEventListener('click', (e) => {
    if (e.target === existingCodeFile || e.target.closest('.code-filename-settings')) {
      return; // Ignore clicking filename settings
    }
    toggleExistingCode.classList.toggle('active');
    if (existingCodeWrapper.style.maxHeight) {
      existingCodeWrapper.style.maxHeight = null;
    } else {
      existingCodeWrapper.style.maxHeight = existingCodeWrapper.scrollHeight + 'px';
    }
  });

  // Load challenges from server and update selector
  async function refreshChallengesList(selectIdAfterRefresh = null, triggerChange = true) {
    try {
      const response = await fetch('/api/challenges');
      if (!response.ok) throw new Error('Failed to load challenges');
      
      const data = await response.json();
      challengesCache = data.challenges || [];
      
      // Clear except for the first "New Challenge" option
      while (challengeSelect.options.length > 1) {
        challengeSelect.remove(1);
      }
      
      challengesCache.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.id} ${c.hasOutputs ? '💾' : '✏️'}`;
        challengeSelect.appendChild(opt);
      });

      if (selectIdAfterRefresh) {
        challengeSelect.value = selectIdAfterRefresh;
        if (triggerChange) {
          await handleChallengeChange();
        }
      }
    } catch (err) {
      console.error('Error loading challenges:', err);
    }
  }

  // Handle challenge selection change
  challengeSelect.addEventListener('change', handleChallengeChange);

  // Sync model dropdown changes to check for existing outputs
  modelA.addEventListener('change', checkForExistingOutputs);
  modelB.addEventListener('change', checkForExistingOutputs);

  async function handleChallengeChange() {
    const selected = challengeSelect.value;
    
    if (selected === 'new') {
      newChallengeGroup.classList.remove('hidden');
      newChallengeName.value = '';
      taskPrompt.value = '';
      existingCode.value = '';
      existingCodeFile.value = 'code.js';
      codeExtIndicator.textContent = 'code.js';
      
      // Hide active screens
      comparisonWorkspace.classList.add('hidden');
      runJudgeBtn.disabled = true;
      
      // Reset Judge Section
      judgePlaceholder.classList.remove('hidden');
      judgeResults.classList.add('hidden');
      judgeLoading.classList.add('hidden');
      judgeError.classList.add('hidden');
    } else {
      newChallengeGroup.classList.add('hidden');
      
      const challenge = challengesCache.find(c => c.id === selected);
      if (!challenge) return;
      
      // Populate inputs
      taskPrompt.value = challenge.prompt || '';
      existingCode.value = challenge.existingCode || '';
      existingCodeFile.value = challenge.existingCodeFile || 'code.js';
      codeExtIndicator.textContent = challenge.existingCodeFile || 'code.js';
      
      // If it already has outputs, fetch the meta data first to set the dropdown values
      if (challenge.hasOutputs) {
        try {
          const response = await fetch(`/api/outputs/${challenge.id}`);
          if (response.ok) {
            const data = await response.json();
            if (data.modelAId) modelA.value = data.modelAId;
            if (data.modelBId) modelB.value = data.modelBId;
          }
        } catch (e) {
          console.error('Error loading meta for dropdown sync:', e);
        }
      }
      
      // Check and display the outputs for the currently selected models
      await checkForExistingOutputs();
    }
  }

  // Check for existing outputs for the currently selected challenge and models
  async function checkForExistingOutputs() {
    const selectedChallenge = challengeSelect.value;
    if (selectedChallenge === 'new') {
      // Clear comparison and judge workspace
      comparisonWorkspace.classList.add('hidden');
      runJudgeBtn.disabled = true;
      
      judgePlaceholder.classList.remove('hidden');
      judgeResults.classList.add('hidden');
      judgeLoading.classList.add('hidden');
      judgeError.classList.add('hidden');
      return;
    }

    const mValA = modelA.value;
    const mValB = modelB.value;
    const nameA = modelA.selectedIndex >= 0 ? modelA.options[modelA.selectedIndex].text : (mValA.split('/')[1] || mValA);
    const nameB = modelB.selectedIndex >= 0 ? modelB.options[modelB.selectedIndex].text : (mValB.split('/')[1] || mValB);
    
    // We try to load specific outputs for these models
    try {
      const response = await fetch(`/api/outputs/${selectedChallenge}?modelA=${encodeURIComponent(mValA)}&modelB=${encodeURIComponent(mValB)}`);
      
      if (response.ok) {
        const data = await response.json();
        
        // Show comparison workspace
        comparisonWorkspace.classList.remove('hidden');
        storageNotice.classList.remove('hidden'); // "Loaded from disk"
        
        // Update Active Session cache
        activeSession.challengeId = selectedChallenge;
        activeSession.outputA = data.modelAExists ? data.modelA : '';
        activeSession.outputB = data.modelBExists ? data.modelB : '';
        activeSession.prompt = taskPrompt.value;
        activeSession.existingCode = existingCode.value;
        activeSession.modelAName = nameA;
        activeSession.modelBName = nameB;

        // Process Column A
        if (data.modelAExists) {
          labelModelA.textContent = `${nameA} (Saved)`;
          contentA.innerHTML = marked.parse(data.modelA || '_No output text recorded_');
          contentA.classList.remove('hidden');
          errorA.classList.add('hidden');
          loadingA.classList.add('hidden');
        } else {
          labelModelA.textContent = nameA;
          contentA.innerHTML = '';
          contentA.classList.add('hidden');
          errorA.textContent = `No saved output for ${nameA} on this challenge. Click Generate to run.`;
          errorA.classList.remove('hidden');
          loadingA.classList.add('hidden');
        }

        // Process Column B
        if (data.modelBExists) {
          labelModelB.textContent = `${nameB} (Saved)`;
          contentB.innerHTML = marked.parse(data.modelB || '_No output text recorded_');
          contentB.classList.remove('hidden');
          errorB.classList.add('hidden');
          loadingB.classList.add('hidden');
        } else {
          labelModelB.textContent = nameB;
          contentB.innerHTML = '';
          contentB.classList.add('hidden');
          errorB.textContent = `No saved output for ${nameB} on this challenge. Click Generate to run.`;
          errorB.classList.remove('hidden');
          loadingB.classList.add('hidden');
        }
        
        // Highlight syntax
        document.querySelectorAll('.markdown-body pre code').forEach((block) => {
          hljs.highlightElement(block);
        });
        
        // Render Judge if present and BOTH models have outputs
        if (data.judge && data.modelAExists && data.modelBExists) {
          judgePlaceholder.classList.add('hidden');
          renderJudgeScorecard(data.judge);
          runJudgeBtn.disabled = true;
        } else {
          // Reset judge view to placeholder
          judgePlaceholder.classList.remove('hidden');
          judgeResults.classList.add('hidden');
          judgeLoading.classList.add('hidden');
          judgeError.classList.add('hidden');
          
          // Only enable Judge if both models have outputs
          runJudgeBtn.disabled = !(data.modelAExists && data.modelBExists);
        }
      }
    } catch (err) {
      console.error('Error checking for existing outputs:', err);
    }
  }

  // Helper to parse and render Judge scorecard markdown + JSON
  function renderJudgeScorecard(judgeText) {
    judgePlaceholder.classList.add('hidden');
    judgeSection.classList.remove('hidden');
    judgeLoading.classList.add('hidden');
    judgeError.classList.add('hidden');
    judgeResults.classList.remove('hidden');
    runJudgeBtn.disabled = true;
    
    judgeVerdictBanner.className = 'verdict-banner';

    let winner = 'Tie';
    let explanation = 'Both models offered high-quality solutions.';
    let cleanedText = judgeText;

    const jsonRegex = /```json\n([\s\S]*?)\n```/;
    const match = judgeText.match(jsonRegex);
    
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        winner = parsed.winner || 'Tie';
        explanation = parsed.explanation || '';
        cleanedText = judgeText.replace(jsonRegex, '');
      } catch (e) {
        console.error('Failed to parse judge JSON verdict:', e);
      }
    }

    judgeWinner.textContent = winner === 'Tie' ? 'Draw / Tie' : `${winner} Wins`;
    judgeShortExplanation.textContent = explanation;
    judgeContent.innerHTML = marked.parse(cleanedText);

    // Style banner
    if (winner.toLowerCase().includes('model a')) {
      judgeVerdictBanner.classList.add('winner-a-active');
    } else if (winner.toLowerCase().includes('model b')) {
      judgeVerdictBanner.classList.add('winner-b-active');
    } else {
      judgeVerdictBanner.classList.add('winner-tie-active');
    }

    // Highlight syntax
    document.querySelectorAll('.judge-details pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  }

  // Settings Modal Logic
  settingsBtn.addEventListener('click', () => {
    settingsOverlay.classList.remove('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsOverlay.classList.add('hidden');
  });

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.classList.add('hidden');
    }
  });

  // Password toggles
  document.querySelectorAll('.toggle-password-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const icon = btn.querySelector('i');
      
      if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
      } else {
        input.type = 'password';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
      }
    });
  });

  // Save Settings
  saveSettingsBtn.addEventListener('click', () => {
    localStorage.setItem('code_arena_openai_key', keyOpenAI.value.trim());
    localStorage.setItem('code_arena_anthropic_key', keyAnthropic.value.trim());
    localStorage.setItem('code_arena_gemini_key', keyGemini.value.trim());
    
    saveSettingsBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
    saveSettingsBtn.style.background = '#10b981';
    
    setTimeout(() => {
      saveSettingsBtn.innerHTML = 'Save API Keys';
      saveSettingsBtn.style.background = '';
      settingsOverlay.classList.add('hidden');
    }, 1000);
  });

  function loadApiKeys() {
    keyOpenAI.value = localStorage.getItem('code_arena_openai_key') || '';
    keyAnthropic.value = localStorage.getItem('code_arena_anthropic_key') || '';
    keyGemini.value = localStorage.getItem('code_arena_gemini_key') || '';
  }

  function getApiKeys() {
    return {
      openai: localStorage.getItem('code_arena_openai_key') || '',
      anthropic: localStorage.getItem('code_arena_anthropic_key') || '',
      gemini: localStorage.getItem('code_arena_gemini_key') || ''
    };
  }

  function hasRequiredKeys(modelVal) {
    const keys = getApiKeys();
    const provider = modelVal.split('/')[0];
    if (provider === 'openai' && !keys.openai) return 'OpenAI';
    if (provider === 'anthropic' && !keys.anthropic) return 'Anthropic';
    if (provider === 'gemini' && !keys.gemini) return 'Gemini';
    return null;
  }

  // Generate & Compare Code Outputs
  generateBtn.addEventListener('click', async () => {
    const promptText = taskPrompt.value.trim();
    if (!promptText) {
      alert('Please enter a coding task prompt first.');
      return;
    }

    let cId = challengeSelect.value;
    if (cId === 'new') {
      cId = newChallengeName.value.trim();
      if (!cId) {
        alert('Please specify a Challenge Name to save your files under.');
        newChallengeName.focus();
        return;
      }
    }

    // Verify key existence
    const missingKeyA = hasRequiredKeys(modelA.value);
    const missingKeyB = hasRequiredKeys(modelB.value);
    if (missingKeyA || missingKeyB) {
      const missing = [missingKeyA, missingKeyB].filter(Boolean);
      const uniqueMissing = [...new Set(missing)];
      alert(`Please configure your API keys in Settings. Missing key for: ${uniqueMissing.join(', ')}`);
      settingsOverlay.classList.remove('hidden');
      return;
    }

    // Setup Workspace labels
    const nameA = modelA.options[modelA.selectedIndex].text;
    const nameB = modelB.options[modelB.selectedIndex].text;
    labelModelA.textContent = nameA;
    labelModelB.textContent = nameB;

    // Reset layouts & display workspace
    comparisonWorkspace.classList.remove('hidden');
    storageNotice.classList.add('hidden'); // Running API / Caching logic
    
    // Clear content
    contentA.innerHTML = '';
    contentB.innerHTML = '';
    errorA.classList.add('hidden');
    errorB.classList.add('hidden');
    
    // Loading State
    loadingA.classList.remove('hidden');
    loadingB.classList.remove('hidden');
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Generating & Saving...';

    // Headers with API keys
    const keys = getApiKeys();
    const headers = {
      'Content-Type': 'application/json',
      'x-openai-key': keys.openai,
      'x-anthropic-key': keys.anthropic,
      'x-gemini-key': keys.gemini
    };

    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          prompt: promptText,
          existingCode: existingCode.value.trim(),
          existingCodeFile: existingCodeFile.value.trim(),
          challengeId: cId,
          modelA: modelA.value,
          modelB: modelB.value,
          modelAName: nameA,
          modelBName: nameB,
          forceRegenerate: forceRegenerate.checked
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to call server API: ${response.statusText}`);
      }

      const data = await response.json();

      // Stop loading
      loadingA.classList.add('hidden');
      loadingB.classList.add('hidden');
      generateBtn.disabled = false;
      generateBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Generate & Compare';

      // Process Model A
      if (data.modelA.error) {
        errorA.textContent = data.modelA.error;
        errorA.classList.remove('hidden');
      } else {
        contentA.innerHTML = marked.parse(data.modelA.text);
        activeSession.outputA = data.modelA.text;
      }

      // Process Model B
      if (data.modelB.error) {
        errorB.textContent = data.modelB.error;
        errorB.classList.remove('hidden');
      } else {
        contentB.innerHTML = marked.parse(data.modelB.text);
        activeSession.outputB = data.modelB.text;
      }

      // Highlight syntax inside content A & B
      document.querySelectorAll('.markdown-body pre code').forEach((block) => {
        hljs.highlightElement(block);
      });

      // Refresh list and select the active challenge silently (avoiding race re-loads)
      await refreshChallengesList(data.challengeId, false);

      // If both completed successfully
      if (!data.modelA.error && !data.modelB.error) {
        // Enable Run Judge button since we have fresh code outputs
        runJudgeBtn.disabled = false;
        
        // Cache outputs
        activeSession.challengeId = data.challengeId;
        activeSession.prompt = promptText;
        activeSession.existingCode = existingCode.value.trim();
        activeSession.modelAName = nameA;
        activeSession.modelBName = nameB;

        // Auto Scroll to workspace
        comparisonWorkspace.scrollIntoView({ behavior: 'smooth' });

        // Auto run judge if checked
        if (autoRunJudge.checked) {
          await executeJudgeRun();
        } else {
          // Reset judge view to placeholder
          judgePlaceholder.classList.remove('hidden');
          judgeResults.classList.add('hidden');
          judgeLoading.classList.add('hidden');
          judgeError.classList.add('hidden');
        }
      }

    } catch (err) {
      loadingA.classList.add('hidden');
      loadingB.classList.add('hidden');
      generateBtn.disabled = false;
      generateBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Generate & Compare';
      alert(`Error during processing: ${err.message}`);
    }
  });

  // Reusable AI Judge execution helper
  async function executeJudgeRun() {
    const missingJudgeKey = hasRequiredKeys(judgeModel.value);
    if (missingJudgeKey) {
      alert(`Please configure your API key for the AI Judge model in Settings: ${missingJudgeKey}`);
      settingsOverlay.classList.remove('hidden');
      return;
    }

    judgePlaceholder.classList.add('hidden');
    judgeSection.classList.remove('hidden');
    judgeLoading.classList.remove('hidden');
    judgeResults.classList.add('hidden');
    judgeError.classList.add('hidden');
    runJudgeBtn.disabled = true;

    judgeVerdictBanner.className = 'verdict-banner';

    const keys = getApiKeys();
    const headers = {
      'Content-Type': 'application/json',
      'x-openai-key': keys.openai,
      'x-anthropic-key': keys.anthropic,
      'x-gemini-key': keys.gemini
    };

    try {
      const response = await fetch('/api/judge', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          challengeId: activeSession.challengeId,
          prompt: activeSession.prompt,
          existingCode: activeSession.existingCode,
          modelAName: activeSession.modelAName,
          modelBName: activeSession.modelBName,
          outputA: activeSession.outputA,
          outputB: activeSession.outputB,
          judgeModel: judgeModel.value
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }

      const data = await response.json();
      
      // Render scorecard and victory cards
      renderJudgeScorecard(data.evaluation);
      
      // Refresh current challenges state silently to update list icon status
      await refreshChallengesList(activeSession.challengeId, false);
      
      // Scroll to findings
      judgeSection.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
      judgeLoading.classList.add('hidden');
      runJudgeBtn.disabled = false;
      judgeError.textContent = `Judge Error: ${err.message}`;
      judgeError.classList.remove('hidden');
    }
  }

  // AI Judge execution trigger
  runJudgeBtn.addEventListener('click', executeJudgeRun);

  // Copy buttons handler
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const textToCopy = activeSession[targetId === 'contentA' ? 'outputA' : 'outputB'];
      
      if (!textToCopy) return;

      navigator.clipboard.writeText(textToCopy).then(() => {
        const icon = btn.querySelector('i');
        icon.className = 'fa-solid fa-check';
        btn.style.color = '#10b981';
        btn.style.borderColor = '#10b981';

        setTimeout(() => {
          icon.className = 'fa-regular fa-copy';
          btn.style.color = '';
          btn.style.borderColor = '';
        }, 1500);
      }).catch(err => {
        console.error('Failed to copy text:', err);
      });
    });
  });
});
