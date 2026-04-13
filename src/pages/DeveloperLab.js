import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import { devLabApi } from '../utils/devLabApi';

const INTENTS = ['general', 'factual', 'thematic', 'recommendation', 'creative'];
const EMPTY_DASHBOARD = {
  counts: { movie_count: 0, tv_count: 0, book_count: 0, knowledge_count: 0, eval_case_count: 0 },
  prompts: [],
  knowledge: [],
  evalCases: [],
  evalRuns: [],
};

function splitList(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Just now' : date.toLocaleString();
}

function buildPromptDrafts(prompts) {
  return (prompts || []).reduce((accumulator, prompt) => {
    accumulator[prompt.intent] = {
      label: prompt.label || prompt.intent,
      description: prompt.description || '',
      systemPrompt: prompt.systemPrompt || '',
      temperature: String(prompt.temperature ?? 0.4),
      maxTitles: String(prompt.maxTitles ?? 5),
    };
    return accumulator;
  }, {});
}

export default function DeveloperLab() {
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [promptDrafts, setPromptDrafts] = useState({});
  const [selectedIntent, setSelectedIntent] = useState('general');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const [apiForm, setApiForm] = useState({ provider: 'tmdb', mediaType: 'movie', query: '', limit: 5 });
  const [urlForm, setUrlForm] = useState({ url: '', title: '', mediaType: '', tags: '' });
  const [manualForm, setManualForm] = useState({
    title: '',
    sourceLabel: '',
    mediaType: '',
    tags: '',
    content: '',
    sourceType: 'manual_text',
  });
  const [previewForm, setPreviewForm] = useState({
    question: '',
    forcedIntent: 'auto',
    includeWebSearch: true,
  });
  const [evalForm, setEvalForm] = useState({
    label: '',
    question: '',
    expectedIntent: '',
    expectedPhrases: '',
    forbiddenPhrases: '',
    notes: '',
  });

  const refreshDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await devLabApi.getDashboard();
      setDashboard(data);
      setPromptDrafts(buildPromptDrafts(data.prompts));
      if (data.prompts?.length) {
        setSelectedIntent((current) => (data.prompts.some((prompt) => prompt.intent === current) ? current : data.prompts[0].intent));
      }
    } catch (nextError) {
      setError(nextError.message || 'Unable to load the developer lab.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  const selectedPrompt = promptDrafts[selectedIntent];
  const promptOptions = useMemo(() => Object.keys(promptDrafts).sort(), [promptDrafts]);

  async function runAction(key, action) {
    setBusy(key);
    setStatus('');
    setError('');
    try {
      await action();
    } catch (nextError) {
      setError(nextError.message || 'Something went wrong.');
    } finally {
      setBusy('');
    }
  }

  async function handleApiImport(event) {
    event.preventDefault();
    await runAction('api', async () => {
      const result = await devLabApi.importCatalogFromApi({
        provider: apiForm.provider,
        mediaType: apiForm.mediaType,
        query: apiForm.query,
        limit: Number(apiForm.limit) || 5,
      });
      setStatus(result.message || 'Catalog import finished.');
      await refreshDashboard();
    });
  }

  async function handleUrlIngest(event) {
    event.preventDefault();
    await runAction('url', async () => {
      const result = await devLabApi.scrapeUrlDocument({
        url: urlForm.url,
        title: urlForm.title,
        mediaType: urlForm.mediaType || null,
        tags: splitList(urlForm.tags),
      });
      setStatus(result.message || 'URL document saved.');
      setUrlForm({ url: '', title: '', mediaType: '', tags: '' });
      await refreshDashboard();
    });
  }

  async function handleManualIngest(event) {
    event.preventDefault();
    await runAction('manual', async () => {
      const result = await devLabApi.saveManualDocument({
        title: manualForm.title,
        sourceLabel: manualForm.sourceLabel,
        mediaType: manualForm.mediaType || null,
        tags: splitList(manualForm.tags),
        content: manualForm.content,
        sourceType: manualForm.sourceType,
      });
      setStatus(result.message || 'Knowledge document saved.');
      setManualForm((current) => ({
        ...current,
        title: '',
        sourceLabel: '',
        tags: '',
        content: '',
        sourceType: 'manual_text',
      }));
      await refreshDashboard();
    });
  }

  async function handlePromptSave(event) {
    event.preventDefault();
    if (!selectedPrompt) return;
    await runAction('prompt', async () => {
      const result = await devLabApi.savePromptProfile(selectedIntent, {
        label: selectedPrompt.label,
        description: selectedPrompt.description,
        systemPrompt: selectedPrompt.systemPrompt,
        temperature: Number(selectedPrompt.temperature) || 0.4,
        maxTitles: Number(selectedPrompt.maxTitles) || 5,
      });
      setStatus(result.message || 'Prompt profile saved.');
      await refreshDashboard();
    });
  }

  async function handlePreview(event) {
    event.preventDefault();
    await runAction('preview', async () => {
      const result = await devLabApi.previewPromptResponse(previewForm);
      setPreview(result);
      setStatus(`Preview generated using the ${result.intent} intent.`);
    });
  }

  async function handleEvalSave(event) {
    event.preventDefault();
    await runAction('eval-save', async () => {
      const result = await devLabApi.createEvaluationCase({
        label: evalForm.label,
        question: evalForm.question,
        expectedIntent: evalForm.expectedIntent || null,
        expectedPhrases: splitList(evalForm.expectedPhrases),
        forbiddenPhrases: splitList(evalForm.forbiddenPhrases),
        notes: evalForm.notes,
      });
      setStatus(result.message || 'Evaluation case saved.');
      setEvalForm({
        label: '',
        question: '',
        expectedIntent: '',
        expectedPhrases: '',
        forbiddenPhrases: '',
        notes: '',
      });
      await refreshDashboard();
    });
  }

  async function handleRunEvals(caseIds = []) {
    await runAction(caseIds.length ? `eval-${caseIds[0]}` : 'eval-all', async () => {
      const result = await devLabApi.runEvaluations({ caseIds, includeWebSearch: true });
      setStatus(result.message || 'Evaluations finished.');
      await refreshDashboard();
    });
  }

  async function handleDeleteKnowledge(id) {
    await runAction(`knowledge-${id}`, async () => {
      await devLabApi.deleteKnowledgeDocument(id);
      setStatus('Knowledge document removed.');
      await refreshDashboard();
    });
  }

  async function handleDeleteEvalCase(id) {
    await runAction(`case-${id}`, async () => {
      await devLabApi.deleteEvaluationCase(id);
      setStatus('Evaluation case removed.');
      await refreshDashboard();
    });
  }

  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setManualForm((current) => ({
        ...current,
        title: current.title || file.name.replace(/\.[^.]+$/, ''),
        sourceLabel: current.sourceLabel || file.name,
        content: text,
        sourceType: 'file_upload',
      }));
      setStatus(`Loaded ${file.name} into the editor.`);
      setError('');
    } catch (nextError) {
      setError(nextError.message || 'Unable to read that file.');
    } finally {
      event.target.value = '';
    }
  }

  return (
    <div className="app-layout">
      <Navbar minimal />
      <main className="page-content devlab-page">
        <section className="devlab-hero">
          <div>
            <p className="devlab-eyebrow">Hidden Developer Route</p>
            <h1>Developer Knowledge Lab</h1>
            <p className="devlab-subtitle">
              This page is only reachable by changing the URL. It is not linked anywhere in the main
              navigation, and it lets you manage Supabase-backed catalog imports, knowledge documents,
              prompts, and evaluation checks from one place.
            </p>
          </div>
          <div className="devlab-count-grid">
            <div className="devlab-count-card"><span>Movies</span><strong>{dashboard.counts.movie_count}</strong></div>
            <div className="devlab-count-card"><span>TV Shows</span><strong>{dashboard.counts.tv_count}</strong></div>
            <div className="devlab-count-card"><span>Books</span><strong>{dashboard.counts.book_count}</strong></div>
            <div className="devlab-count-card"><span>Knowledge Docs</span><strong>{dashboard.counts.knowledge_count}</strong></div>
          </div>
        </section>

        {(status || error) && (
          <section className="devlab-banner-row">
            {status ? <div className="devlab-banner devlab-banner--success">{status}</div> : null}
            {error ? <div className="devlab-banner devlab-banner--error">{error}</div> : null}
          </section>
        )}

        {loading ? (
          <div className="loading-state">Loading the developer lab...</div>
        ) : (
          <>
            <section className="devlab-grid">
              <article className="devlab-panel">
                <h2>API Catalog Import</h2>
                <p className="devlab-muted">Method 1: import directly into the live Supabase catalog via TMDB or Open Library.</p>
                <form className="devlab-form" onSubmit={handleApiImport}>
                  <div className="devlab-form-grid">
                    <label><span>Provider</span><select value={apiForm.provider} onChange={(event) => {
                      const provider = event.target.value;
                      setApiForm((current) => ({
                        ...current,
                        provider,
                        mediaType: provider === 'openlibrary' ? 'book' : current.mediaType === 'book' ? 'movie' : current.mediaType,
                      }));
                    }}><option value="tmdb">TMDB</option><option value="openlibrary">Open Library</option></select></label>
                    <label><span>Media Type</span><select value={apiForm.mediaType} onChange={(event) => setApiForm((current) => ({ ...current, mediaType: event.target.value }))}>
                      {apiForm.provider === 'tmdb' ? <><option value="movie">Movie</option><option value="tv_show">TV Show</option></> : <option value="book">Book</option>}
                    </select></label>
                    <label><span>Limit</span><input type="number" min="1" max="10" value={apiForm.limit} onChange={(event) => setApiForm((current) => ({ ...current, limit: event.target.value }))} /></label>
                  </div>
                  <label><span>Search Query</span><input type="text" value={apiForm.query} placeholder="e.g. Interstellar" onChange={(event) => setApiForm((current) => ({ ...current, query: event.target.value }))} /></label>
                  <button className="btn-primary" type="submit" disabled={busy === 'api'}>{busy === 'api' ? 'Importing...' : 'Import Into Supabase'}</button>
                </form>
              </article>

              <article className="devlab-panel">
                <h2>URL Scraping</h2>
                <p className="devlab-muted">Method 2: scrape a remote page into the Supabase knowledge base.</p>
                <form className="devlab-form" onSubmit={handleUrlIngest}>
                  <label><span>URL</span><input type="url" value={urlForm.url} placeholder="https://example.com/article" onChange={(event) => setUrlForm((current) => ({ ...current, url: event.target.value }))} /></label>
                  <div className="devlab-form-grid">
                    <label><span>Title Override</span><input type="text" value={urlForm.title} onChange={(event) => setUrlForm((current) => ({ ...current, title: event.target.value }))} /></label>
                    <label><span>Media Type</span><select value={urlForm.mediaType} onChange={(event) => setUrlForm((current) => ({ ...current, mediaType: event.target.value }))}><option value="">General</option><option value="movie">Movie</option><option value="tv_show">TV Show</option><option value="book">Book</option></select></label>
                  </div>
                  <label><span>Tags</span><input type="text" value={urlForm.tags} placeholder="comma-separated tags" onChange={(event) => setUrlForm((current) => ({ ...current, tags: event.target.value }))} /></label>
                  <button className="btn-primary" type="submit" disabled={busy === 'url'}>{busy === 'url' ? 'Scraping...' : 'Scrape Into Knowledge Base'}</button>
                </form>
              </article>

              <article className="devlab-panel">
                <h2>Manual Text Or File Upload</h2>
                <p className="devlab-muted">Method 3: paste text or upload a local file into the knowledge base.</p>
                <form className="devlab-form" onSubmit={handleManualIngest}>
                  <div className="devlab-form-grid">
                    <label><span>Title</span><input type="text" value={manualForm.title} onChange={(event) => setManualForm((current) => ({ ...current, title: event.target.value }))} /></label>
                    <label><span>Source Label</span><input type="text" value={manualForm.sourceLabel} onChange={(event) => setManualForm((current) => ({ ...current, sourceLabel: event.target.value }))} /></label>
                  </div>
                  <div className="devlab-form-grid">
                    <label><span>Media Type</span><select value={manualForm.mediaType} onChange={(event) => setManualForm((current) => ({ ...current, mediaType: event.target.value }))}><option value="">General</option><option value="movie">Movie</option><option value="tv_show">TV Show</option><option value="book">Book</option></select></label>
                    <label><span>Tags</span><input type="text" value={manualForm.tags} placeholder="comma-separated tags" onChange={(event) => setManualForm((current) => ({ ...current, tags: event.target.value }))} /></label>
                  </div>
                  <label><span>Optional File</span><input type="file" accept=".txt,.md,.json,.csv" onChange={handleFileUpload} /></label>
                  <label><span>Content</span><textarea rows={8} value={manualForm.content} onChange={(event) => setManualForm((current) => ({ ...current, content: event.target.value }))} /></label>
                  <button className="btn-primary" type="submit" disabled={busy === 'manual'}>{busy === 'manual' ? 'Saving...' : 'Save Knowledge Document'}</button>
                </form>
              </article>

              <article className="devlab-panel">
                <h2>Prompt Profiles</h2>
                {selectedPrompt ? (
                  <form className="devlab-form" onSubmit={handlePromptSave}>
                    <label><span>Intent</span><select value={selectedIntent} onChange={(event) => setSelectedIntent(event.target.value)}>{promptOptions.map((intent) => <option key={intent} value={intent}>{intent}</option>)}</select></label>
                    <div className="devlab-form-grid">
                      <label><span>Label</span><input type="text" value={selectedPrompt.label} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], label: event.target.value } }))} /></label>
                      <label><span>Temperature</span><input type="number" min="0" max="1" step="0.05" value={selectedPrompt.temperature} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], temperature: event.target.value } }))} /></label>
                      <label><span>Max Titles</span><input type="number" min="1" max="12" value={selectedPrompt.maxTitles} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], maxTitles: event.target.value } }))} /></label>
                    </div>
                    <label><span>Description</span><input type="text" value={selectedPrompt.description} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], description: event.target.value } }))} /></label>
                    <label><span>System Prompt</span><textarea rows={10} value={selectedPrompt.systemPrompt} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], systemPrompt: event.target.value } }))} /></label>
                    <button className="btn-primary" type="submit" disabled={busy === 'prompt'}>{busy === 'prompt' ? 'Saving...' : 'Save Prompt Profile'}</button>
                  </form>
                ) : <p className="devlab-muted">No prompt profiles available.</p>}
              </article>
            </section>

            <section className="devlab-grid devlab-grid--two-column">
              <article className="devlab-panel">
                <h2>Prompt Preview</h2>
                <form className="devlab-form" onSubmit={handlePreview}>
                  <div className="devlab-form-grid">
                    <label><span>Intent</span><select value={previewForm.forcedIntent} onChange={(event) => setPreviewForm((current) => ({ ...current, forcedIntent: event.target.value }))}><option value="auto">Auto-detect</option>{INTENTS.map((intent) => <option key={intent} value={intent}>{intent}</option>)}</select></label>
                    <label className="devlab-inline-checkbox"><input type="checkbox" checked={previewForm.includeWebSearch} onChange={(event) => setPreviewForm((current) => ({ ...current, includeWebSearch: event.target.checked }))} /><span>Include web search</span></label>
                  </div>
                  <label><span>Question</span><textarea rows={5} value={previewForm.question} placeholder="Ask the preview assistant a question" onChange={(event) => setPreviewForm((current) => ({ ...current, question: event.target.value }))} /></label>
                  <button className="btn-primary" type="submit" disabled={busy === 'preview'}>{busy === 'preview' ? 'Generating...' : 'Run Preview'}</button>
                </form>

                {preview ? (
                  <div className="devlab-preview">
                    <div className="devlab-chip-row">
                      <span className="devlab-chip">Intent: {preview.intent}</span>
                      <span className="devlab-chip">Latency: {preview.latencyMs} ms</span>
                    </div>
                    <div className="devlab-preview-block">
                      <h3>Response</h3>
                      <pre>{preview.responseText}</pre>
                    </div>
                    <div className="devlab-preview-block">
                      <h3>System Prompt</h3>
                      <pre>{preview.systemPrompt}</pre>
                    </div>
                    <div className="devlab-preview-block">
                      <h3>Knowledge Sources</h3>
                      <p>{(preview.knowledgeDocs || []).map((item) => item.title).join(', ') || 'None'}</p>
                    </div>
                  </div>
                ) : null}
              </article>

              <article className="devlab-panel">
                <h2>Evaluation Cases</h2>
                <form className="devlab-form" onSubmit={handleEvalSave}>
                  <label><span>Label</span><input type="text" value={evalForm.label} onChange={(event) => setEvalForm((current) => ({ ...current, label: event.target.value }))} /></label>
                  <label><span>Question</span><textarea rows={3} value={evalForm.question} onChange={(event) => setEvalForm((current) => ({ ...current, question: event.target.value }))} /></label>
                  <div className="devlab-form-grid">
                    <label><span>Expected Intent</span><select value={evalForm.expectedIntent} onChange={(event) => setEvalForm((current) => ({ ...current, expectedIntent: event.target.value }))}><option value="">No intent check</option>{INTENTS.map((intent) => <option key={intent} value={intent}>{intent}</option>)}</select></label>
                    <label><span>Expected Phrases</span><textarea rows={3} value={evalForm.expectedPhrases} placeholder="one phrase per line" onChange={(event) => setEvalForm((current) => ({ ...current, expectedPhrases: event.target.value }))} /></label>
                    <label><span>Forbidden Phrases</span><textarea rows={3} value={evalForm.forbiddenPhrases} placeholder="one phrase per line" onChange={(event) => setEvalForm((current) => ({ ...current, forbiddenPhrases: event.target.value }))} /></label>
                  </div>
                  <label><span>Notes</span><input type="text" value={evalForm.notes} onChange={(event) => setEvalForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                  <div className="devlab-button-row">
                    <button className="btn-primary" type="submit" disabled={busy === 'eval-save'}>{busy === 'eval-save' ? 'Saving...' : 'Save Eval Case'}</button>
                    <button className="btn-ghost" type="button" onClick={() => handleRunEvals([])} disabled={busy === 'eval-all' || !dashboard.evalCases.length}>{busy === 'eval-all' ? 'Running...' : 'Run All Cases'}</button>
                  </div>
                </form>

                <div className="devlab-list-block">
                  <h3>Saved Cases</h3>
                  <div className="devlab-list">
                    {dashboard.evalCases.length ? dashboard.evalCases.map((testCase) => (
                      <div key={testCase.id} className="devlab-list-item">
                        <div className="devlab-list-copy">
                          <strong>{testCase.label}</strong>
                          <p>{testCase.question}</p>
                          <p className="devlab-muted">{(testCase.expectedPhrases || []).join(', ') || 'No expected phrases'}</p>
                        </div>
                        <div className="devlab-list-actions">
                          <button className="btn-ghost" type="button" onClick={() => handleRunEvals([testCase.id])} disabled={busy === `eval-${testCase.id}`}>{busy === `eval-${testCase.id}` ? 'Running...' : 'Run'}</button>
                          <button className="btn-ghost btn-ghost--danger" type="button" onClick={() => handleDeleteEvalCase(testCase.id)} disabled={busy === `case-${testCase.id}`}>Delete</button>
                        </div>
                      </div>
                    )) : <p className="devlab-muted">No evaluation cases saved yet.</p>}
                  </div>
                </div>

                <div className="devlab-list-block">
                  <h3>Recent Runs</h3>
                  <div className="devlab-list">
                    {dashboard.evalRuns.length ? dashboard.evalRuns.map((run) => (
                      <div key={run.id} className="devlab-list-item">
                        <div className="devlab-list-copy">
                          <strong>{run.label || 'Untitled run'}</strong>
                          <p>{run.question}</p>
                          <div className="devlab-chip-row">
                            <span className={`devlab-chip ${run.passed ? 'devlab-chip--success' : 'devlab-chip--danger'}`}>{run.passed ? 'Passed' : 'Failed'}</span>
                            <span className="devlab-chip">Intent: {run.selectedIntent || 'n/a'}</span>
                            <span className="devlab-chip">{formatTime(run.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    )) : <p className="devlab-muted">No evaluation runs yet.</p>}
                  </div>
                </div>
              </article>
            </section>

            <section className="devlab-grid devlab-grid--two-column">
              <article className="devlab-panel">
                <h2>Knowledge Documents</h2>
                <div className="devlab-list">
                  {dashboard.knowledge.length ? dashboard.knowledge.map((document) => (
                    <div key={document.id} className="devlab-list-item">
                      <div className="devlab-list-copy">
                        <strong>{document.title}</strong>
                        <p>{document.summary || document.excerpt}</p>
                        <div className="devlab-chip-row">
                          <span className="devlab-chip">{document.sourceType}</span>
                          {document.mediaType ? <span className="devlab-chip">{document.mediaType}</span> : null}
                          <span className="devlab-chip">{formatTime(document.updatedAt)}</span>
                        </div>
                      </div>
                      <div className="devlab-list-actions">
                        <button className="btn-ghost btn-ghost--danger" type="button" onClick={() => handleDeleteKnowledge(document.id)} disabled={busy === `knowledge-${document.id}`}>Delete</button>
                      </div>
                    </div>
                  )) : <p className="devlab-muted">No knowledge documents saved yet.</p>}
                </div>
              </article>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
