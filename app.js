const state = {
  model: null,
  config: { advancedAvailable: false, model: null },
  mode: 'local',
  busy: false,
};

const els = {
  input: document.querySelector('#text-input'),
  analyze: document.querySelector('#analyze-button'),
  analyzeLabel: document.querySelector('#analyze-button span'),
  clear: document.querySelector('#clear-button'),
  sample: document.querySelector('#sample-button'),
  localMode: document.querySelector('#local-mode'),
  advancedMode: document.querySelector('#advanced-mode'),
  advancedModeCopy: document.querySelector('#advanced-mode-copy'),
  disclosure: document.querySelector('#mode-disclosure'),
  privacyNote: document.querySelector('#privacy-note'),
  headerChip: document.querySelector('#header-mode-chip'),
  words: document.querySelector('#word-count'),
  chars: document.querySelector('#char-count'),
  ratio: document.querySelector('#bengali-ratio'),
  warning: document.querySelector('#input-warning'),
  empty: document.querySelector('#empty-result'),
  result: document.querySelector('#result-content'),
  ring: document.querySelector('#score-ring'),
  score: document.querySelector('#score-value'),
  marker: document.querySelector('#score-marker'),
  kicker: document.querySelector('#verdict-kicker'),
  verdict: document.querySelector('#verdict-title'),
  verdictCopy: document.querySelector('#verdict-copy'),
  feedback: document.querySelector('#feedback-list'),
  confidence: document.querySelector('#confidence-label'),
  source: document.querySelector('#analysis-source'),
  version: document.querySelector('#model-version'),
  f1: document.querySelector('#prototype-f1'),
  breakdown: document.querySelector('#score-breakdown'),
  semanticBar: document.querySelector('#semantic-bar'),
  semanticScore: document.querySelector('#semantic-score'),
  lexicalBar: document.querySelector('#lexical-bar'),
  lexicalScore: document.querySelector('#lexical-score'),
  combinedBar: document.querySelector('#combined-bar'),
  combinedScore: document.querySelector('#combined-score'),
};

const SAMPLE = 'বাংলা ভাষা আমাদের সংস্কৃতি ও পরিচয়ের গুরুত্বপূর্ণ অংশ। প্রযুক্তির অগ্রগতির সঙ্গে বাংলা ভাষায় স্বয়ংক্রিয় লেখা তৈরির ক্ষমতাও দ্রুত বাড়ছে। এই পরিবর্তন শিক্ষা, সংবাদ এবং অনলাইন যোগাযোগে নতুন সুযোগ তৈরি করেছে। তবে কোনো লেখার উৎস সম্পর্কে সিদ্ধান্ত নেওয়ার সময় কেবল একটি স্বয়ংক্রিয় স্কোরের ওপর নির্ভর করা উচিত নয়। লেখার প্রেক্ষাপট, খসড়া, তথ্যসূত্র এবং লেখকের ব্যাখ্যাও বিবেচনা করা প্রয়োজন।';

function normalize(text) {
  return text.normalize('NFC')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' URL ')
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, ' EMAIL ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenizeWords(text) {
  return normalize(text).match(/[\u0980-\u09FF]+|[A-Za-z]+|\d+/gu) || [];
}

function extractFeatures(text) {
  const normalized = normalize(text);
  const words = tokenizeWords(normalized);
  const counts = new Map();
  const add = key => counts.set(key, (counts.get(key) || 0) + 1);
  words.forEach(token => add(`w:${token}`));
  for (let i = 0; i < words.length - 1; i += 1) add(`b:${words[i]}_${words[i + 1]}`);
  const compact = ` ${normalized} `;
  for (const n of [3, 4, 5]) {
    for (let i = 0; i <= compact.length - n; i += 1) {
      const gram = compact.slice(i, i + n);
      if (/[\u0980-\u09FF]/u.test(gram)) add(`c${n}:${gram}`);
    }
  }
  return counts;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function documentStats(text) {
  const words = tokenizeWords(text);
  const letters = [...text].filter(ch => /[\p{L}\p{N}]/u.test(ch));
  const bengali = letters.filter(ch => /[\u0980-\u09FF]/u.test(ch));
  return {
    wordCount: words.length,
    characterCount: [...text].length,
    bengaliRatio: letters.length ? bengali.length / letters.length : 0,
  };
}

function updateInputState() {
  const stats = documentStats(els.input.value);
  els.words.textContent = stats.wordCount.toLocaleString();
  els.chars.textContent = stats.characterCount.toLocaleString();
  els.ratio.textContent = `${Math.round(stats.bengaliRatio * 100)}%`;
  els.analyze.disabled = state.busy || !state.model || stats.wordCount < 8 || stats.bengaliRatio < .35;

  if (!els.input.value.trim()) els.warning.textContent = '';
  else if (stats.bengaliRatio < .35) els.warning.textContent = 'Please provide predominantly Bengali text.';
  else if (stats.wordCount < 8) els.warning.textContent = 'Add more text before analysis.';
  else if (stats.wordCount < 40) els.warning.textContent = 'Short text produces a less stable score; 40 or more words is recommended.';
  else if (stats.wordCount > 400) els.warning.textContent = 'Only the first 400 words will be scored to match the document range.';
  else if (stats.bengaliRatio < .75) els.warning.textContent = 'Code-mixed text is supported cautiously and may be less reliable.';
  else els.warning.textContent = '';
}

function predictLocal(text) {
  const boundedText = tokenizeWords(text).slice(0, 400).join(' ');
  const counts = extractFeatures(boundedText);
  let raw = 0;
  for (const [feature, count] of counts) raw += count * (state.model.weights[feature] || 0);
  const c = state.model.calibration;
  const calibrated = sigmoid(c.a * ((raw - c.mean) / c.std) + c.b);
  const words = tokenizeWords(boundedText).length;
  const evidenceFactor = Math.min(1, Math.sqrt(words / 80));
  return .5 + (calibrated - .5) * evidenceFactor;
}

function setMode(mode) {
  if (mode === 'advanced' && !state.config.advancedAvailable) return;
  state.mode = mode;
  const advanced = mode === 'advanced';
  els.localMode.classList.toggle('is-active', !advanced);
  els.advancedMode.classList.toggle('is-active', advanced);
  els.localMode.setAttribute('aria-pressed', String(!advanced));
  els.advancedMode.setAttribute('aria-pressed', String(advanced));
  els.disclosure.textContent = advanced
    ? 'Advanced mode securely sends this passage to the configured semantic-analysis provider. This app does not retain it; provider data policies apply.'
    : 'Local mode does not transmit or store your text.';
  els.privacyNote.textContent = advanced
    ? 'The passage is sent only when you select Analyze. The website does not save submitted text.'
    : 'The model and analysis run entirely in your browser. No submitted text is uploaded or retained.';
  els.headerChip.innerHTML = advanced
    ? '<span aria-hidden="true">●</span> Advanced semantic mode'
    : '<span aria-hidden="true">●</span> Private local mode';
}

function setBusy(busy) {
  state.busy = busy;
  els.analyze.classList.toggle('is-loading', busy);
  els.analyzeLabel.textContent = busy ? 'Analyzing language patterns…' : 'Analyze text';
  updateInputState();
}

function verdictFor(probability) {
  if (probability >= .68) return {
    kicker: 'Strong AI-like signal', title: 'Likely AI-generated',
    copy: 'The passage shows multiple patterns associated with machine-generated Bengali writing.', color: '#c94c5a',
  };
  if (probability <= .32) return {
    kicker: 'Strong human-like signal', title: 'Likely human-written',
    copy: 'The passage shows more of the variation and idiosyncrasy associated with human-written Bengali.', color: '#2ca36b',
  };
  return {
    kicker: 'Mixed or weak signal', title: 'Uncertain result',
    copy: 'The available signals do not support a clear authorship classification.', color: '#d69422',
  };
}

function renderResult(probability, details = {}) {
  const stats = documentStats(els.input.value);
  const percent = Math.round(probability * 100);
  const distance = Math.abs(probability - .5) * 2;
  const evidence = details.confidence ?? distance;
  const confidence = stats.wordCount < 40 ? 'Limited' : evidence > .72 ? 'Higher' : evidence > .42 ? 'Moderate' : 'Low';
  const verdict = verdictFor(probability);
  const guidance = [...(details.observations || [])];

  if (stats.wordCount < 40) guidance.push('The passage is shorter than the recommended range, so the score is less stable.');
  if (stats.bengaliRatio < .75) guidance.push('Code-mixing or Romanized text can weaken Bengali-specific evidence.');
  if (details.notice) guidance.push(details.notice);
  if (!guidance.length && probability >= .68) guidance.push('The vocabulary, structure, and progression collectively form an AI-like pattern.');
  if (!guidance.length && probability <= .32) guidance.push('The passage contains comparatively human-like stylistic variation.');
  if (!guidance.length) guidance.push('The detected signals conflict, so contextual evidence matters more than the percentage.');
  guidance.push('Use drafts, citations, revision history, and author explanation before reaching a decision.');
  guidance.push('Do not use this score as the sole basis for accusation, grading, or disciplinary action.');

  els.empty.hidden = true;
  els.result.hidden = false;
  els.score.textContent = `${percent}%`;
  els.ring.style.setProperty('--score', `${percent * 3.6}deg`);
  els.ring.style.setProperty('--ring-color', verdict.color);
  els.marker.style.left = `${percent}%`;
  els.kicker.textContent = verdict.kicker;
  els.kicker.style.color = verdict.color;
  els.verdict.textContent = verdict.title;
  els.verdictCopy.textContent = details.summary || verdict.copy;
  els.feedback.replaceChildren(...guidance.slice(0, 5).map(item => {
    const li = document.createElement('li');
    li.textContent = item;
    return li;
  }));
  els.confidence.textContent = `Evidence strength: ${confidence}`;
  els.source.textContent = details.source || 'Private local analysis';

  const hasBreakdown = Number.isFinite(details.semanticProbability);
  els.breakdown.hidden = !hasBreakdown;
  if (hasBreakdown) {
    const semantic = Math.round(details.semanticProbability * 100);
    const lexical = Math.round(details.localProbability * 100);
    els.semanticBar.style.width = `${semantic}%`;
    els.lexicalBar.style.width = `${lexical}%`;
    els.combinedBar.style.width = `${percent}%`;
    els.semanticScore.textContent = `${semantic}%`;
    els.lexicalScore.textContent = `${lexical}%`;
    els.combinedScore.textContent = `${percent}%`;
  }
}

async function analyzeText() {
  const localProbability = predictLocal(els.input.value);
  if (state.mode !== 'advanced' || !state.config.advancedAvailable) {
    renderResult(localProbability, { source: 'Private local analysis' });
    return;
  }

  setBusy(true);
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: els.input.value, local_probability: localProbability }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Analysis failed (${response.status})`);
    renderResult(data.ai_probability, {
      semanticProbability: data.semantic_probability,
      localProbability: data.local_probability,
      confidence: data.confidence,
      summary: data.summary,
      observations: data.observations,
      source: `Hybrid analysis · ${data.model}`,
    });
  } catch (error) {
    renderResult(localProbability, {
      source: 'Private local fallback',
      notice: 'Advanced analysis was temporarily unavailable, so this result uses the local detector only.',
    });
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) return;
    state.config = await response.json();
    if (state.config.advancedAvailable) {
      els.advancedMode.disabled = false;
      els.advancedModeCopy.textContent = `Multilingual review · ${state.config.model}`;
    }
  } catch {
    // A plain static server intentionally provides local mode only.
  }
}

async function loadModel() {
  try {
    const response = await fetch('model.json');
    if (!response.ok) throw new Error(`Model request failed (${response.status})`);
    state.model = await response.json();
    els.version.textContent = `Local model: ${state.model.version}`;
    els.f1.textContent = `${(state.model.training.validation.macroF1 * 100).toFixed(1)}%`;
    updateInputState();
  } catch (error) {
    els.warning.textContent = 'The local model could not load. Open this folder through its local server.';
    console.error(error);
  }
}

els.input.addEventListener('input', updateInputState);
els.analyze.addEventListener('click', analyzeText);
els.localMode.addEventListener('click', () => setMode('local'));
els.advancedMode.addEventListener('click', () => setMode('advanced'));
els.clear.addEventListener('click', () => {
  els.input.value = '';
  els.empty.hidden = false;
  els.result.hidden = true;
  updateInputState();
  els.input.focus();
});
els.sample.addEventListener('click', () => {
  els.input.value = SAMPLE;
  updateInputState();
  els.input.focus();
});

Promise.all([loadModel(), loadConfig()]);
