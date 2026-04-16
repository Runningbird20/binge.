import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import { devLabApi } from '../utils/devLabApi';
import { fetchSupabaseAdminRequests, updateSupabaseRequestStatus } from '../utils/supabaseData';

const INTENTS = ['general', 'factual', 'thematic', 'recommendation', 'creative'];
const SECTION_TABS = [
  { id: 'workspace', label: 'Workspace', title: 'Catalog And Knowledge Intake', description: 'Import titles into Supabase, scrape supporting material, and curate the knowledge base the assistant can use.' },
  { id: 'requests', label: 'Requests', title: 'Media Request Review', description: 'Review incoming user submissions and resolve them without leaving the lab.' },
  { id: 'prompting', label: 'Prompting', title: 'Prompt Tuning', description: 'Tune intent-specific prompt profiles and preview the Supabase dev function flow.' },
  { id: 'quality', label: 'Quality', title: 'Evaluation Checks', description: 'Save regression cases, run QA passes, and watch recent eval output.' },
];
const REQUEST_FILTERS = ['pending', 'approved', 'rejected', 'all'];
const REQUEST_MEDIA_ICONS = { movie: 'Movie', tv_show: 'TV', book: 'Book' };
const EMPTY_DASHBOARD = {
  counts: { movie_count: 0, tv_count: 0, book_count: 0, knowledge_count: 0, eval_case_count: 0 },
  prompts: [],
  knowledge: [],
  evalCases: [],
  evalRuns: [],
};
const EMPTY_REQUEST_COUNTS = { pending: 0, approved: 0, rejected: 0, all: 0 };

function splitList(value) {
  return String(value || '').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
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

function normalizeSectionHash(value) {
  const normalized = String(value || '').replace(/^#/, '').trim().toLowerCase();
  return SECTION_TABS.some((tab) => tab.id === normalized) ? normalized : null;
}

function buildRequestCounts(items = []) {
  return items.reduce((accumulator, item) => {
    if (item.status && accumulator[item.status] != null) accumulator[item.status] += 1;
    accumulator.all += 1;
    return accumulator;
  }, { ...EMPTY_REQUEST_COUNTS });
}

function formatRequestFilterLabel(value) {
  const normalized = String(value || '');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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
  const [activeSection, setActiveSection] = useState(() => normalizeSectionHash(typeof window !== 'undefined' ? window.location.hash : '') || 'workspace');

  const [requests, setRequests] = useState([]);
  const [requestFilter, setRequestFilter] = useState('pending');
  const [requestCounts, setRequestCounts] = useState(EMPTY_REQUEST_COUNTS);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestActionId, setRequestActionId] = useState(null);
  const [requestNoteFor, setRequestNoteFor] = useState(null);
  const [requestAdminNote, setRequestAdminNote] = useState('');
  const [requestError, setRequestError] = useState('');

  const [apiForm, setApiForm] = useState({ provider: 'tmdb', mediaType: 'movie', query: '', limit: 5 });
  const [urlForm, setUrlForm] = useState({ url: '', title: '', mediaType: '', tags: '' });
  const [manualForm, setManualForm] = useState({ title: '', sourceLabel: '', mediaType: '', tags: '', content: '', sourceType: 'manual_text' });
  const [previewForm, setPreviewForm] = useState({ question: '', forcedIntent: 'auto', includeWebSearch: true });
  const [evalForm, setEvalForm] = useState({ label: '', question: '', expectedIntent: '', expectedPhrases: '', forbiddenPhrases: '', notes: '' });

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

  const refreshRequests = useCallback(async () => {
    setRequestsLoading(true);
    setRequestError('');
    try {
      const [filteredRequests, allRequests] = await Promise.all([
        fetchSupabaseAdminRequests(requestFilter),
        fetchSupabaseAdminRequests('all'),
      ]);
      setRequests(filteredRequests);
      setRequestCounts(buildRequestCounts(allRequests));
    } catch (nextError) {
      setRequestError(nextError.message || 'Unable to load media requests.');
    } finally {
      setRequestsLoading(false);
    }
  }, [requestFilter]);

  useEffect(() => { refreshDashboard(); }, [refreshDashboard]);
  useEffect(() => { refreshRequests(); }, [refreshRequests]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function handleHashChange() {
      const nextSection = normalizeSectionHash(window.location.hash);
      if (nextSection) setActiveSection(nextSection);
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const selectedPrompt = promptDrafts[selectedIntent];
  const promptOptions = useMemo(() => Object.keys(promptDrafts).sort(), [promptDrafts]);
  const currentSection = SECTION_TABS.find((tab) => tab.id === activeSection) || SECTION_TABS[0];
  const bannerError = error || requestError;

  function selectSection(nextSection) {
    setActiveSection(nextSection);
    if (typeof window !== 'undefined') {
      const nextHash = `#${nextSection}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
      }
    }
  }

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
      const result = await devLabApi.importCatalogFromApi({ provider: apiForm.provider, mediaType: apiForm.mediaType, query: apiForm.query, limit: Number(apiForm.limit) || 5 });
      setStatus(result.message || 'Catalog import finished.');
      await refreshDashboard();
    });
  }

  async function handleUrlIngest(event) {
    event.preventDefault();
    await runAction('url', async () => {
      const result = await devLabApi.scrapeUrlDocument({ url: urlForm.url, title: urlForm.title, mediaType: urlForm.mediaType || null, tags: splitList(urlForm.tags) });
      setStatus(result.message || 'URL document saved.');
      setUrlForm({ url: '', title: '', mediaType: '', tags: '' });
      await refreshDashboard();
    });
  }

  async function handleManualIngest(event) {
    event.preventDefault();
    await runAction('manual', async () => {
      const result = await devLabApi.saveManualDocument({ title: manualForm.title, sourceLabel: manualForm.sourceLabel, mediaType: manualForm.mediaType || null, tags: splitList(manualForm.tags), content: manualForm.content, sourceType: manualForm.sourceType });
      setStatus(result.message || 'Knowledge document saved.');
      setManualForm((current) => ({ ...current, title: '', sourceLabel: '', tags: '', content: '', sourceType: 'manual_text' }));
      await refreshDashboard();
    });
  }

  async function handlePromptSave(event) {
    event.preventDefault();
    if (!selectedPrompt) return;
    await runAction('prompt', async () => {
      const result = await devLabApi.savePromptProfile(selectedIntent, { label: selectedPrompt.label, description: selectedPrompt.description, systemPrompt: selectedPrompt.systemPrompt, temperature: Number(selectedPrompt.temperature) || 0.4, maxTitles: Number(selectedPrompt.maxTitles) || 5 });
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
      const result = await devLabApi.createEvaluationCase({ label: evalForm.label, question: evalForm.question, expectedIntent: evalForm.expectedIntent || null, expectedPhrases: splitList(evalForm.expectedPhrases), forbiddenPhrases: splitList(evalForm.forbiddenPhrases), notes: evalForm.notes });
      setStatus(result.message || 'Evaluation case saved.');
      setEvalForm({ label: '', question: '', expectedIntent: '', expectedPhrases: '', forbiddenPhrases: '', notes: '' });
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

  async function handleUpdateRequestStatus(id, nextStatus) {
    setRequestActionId(id);
    setStatus('');
    setError('');
    setRequestError('');
    try {
      const nextNote = requestNoteFor === id ? requestAdminNote : '';
      await updateSupabaseRequestStatus(id, nextStatus, nextNote);
      setRequestNoteFor(null);
      setRequestAdminNote('');
      setStatus(nextStatus === 'approved' ? 'Request approved.' : nextStatus === 'rejected' ? 'Request rejected.' : 'Request moved back to pending.');
      await refreshRequests();
    } catch (nextError) {
      setRequestError(nextError.message || 'Unable to update the request.');
    } finally {
      setRequestActionId(null);
    }
  }

  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setManualForm((current) => ({ ...current, title: current.title || file.name.replace(/\.[^.]+$/, ''), sourceLabel: current.sourceLabel || file.name, content: text, sourceType: 'file_upload' }));
      setStatus(`Loaded ${file.name} into the editor.`);
      setError('');
    } catch (nextError) {
      setError(nextError.message || 'Unable to read that file.');
    } finally {
      event.target.value = '';
    }
  }

  function renderWorkspaceSection() {
    if (loading) {
      return <div className="loading-state">Loading the developer lab...</div>;
    }

    return (
      <div className="devlab-section-stack">
        <section className="home-section surface-panel">
          <div className="section-header">
            <div>
              <h2>Import And Ingest</h2>
              <p className="home-panel-copy">
                Bring titles and support material into Supabase so the assistant has clean catalog and knowledge context.
              </p>
            </div>
          </div>

          <div className="devlab-panel-grid">
            <article className="devlab-card">
              <h3>API Catalog Import</h3>
              <p className="devlab-muted">Import directly into the live Supabase catalog from TMDB or Open Library.</p>
              <form className="devlab-form" onSubmit={handleApiImport}>
                <div className="devlab-form-grid">
                  <label>
                    <span>Provider</span>
                    <select
                      value={apiForm.provider}
                      onChange={(event) => {
                        const provider = event.target.value;
                        setApiForm((current) => ({
                          ...current,
                          provider,
                          mediaType: provider === 'openlibrary' ? 'book' : current.mediaType === 'book' ? 'movie' : current.mediaType,
                        }));
                      }}
                    >
                      <option value="tmdb">TMDB</option>
                      <option value="openlibrary">Open Library</option>
                    </select>
                  </label>
                  <label>
                    <span>Media Type</span>
                    <select value={apiForm.mediaType} onChange={(event) => setApiForm((current) => ({ ...current, mediaType: event.target.value }))}>
                      {apiForm.provider === 'tmdb' ? (
                        <>
                          <option value="movie">Movie</option>
                          <option value="tv_show">TV Show</option>
                        </>
                      ) : (
                        <option value="book">Book</option>
                      )}
                    </select>
                  </label>
                  <label>
                    <span>Limit</span>
                    <input type="number" min="1" max="10" value={apiForm.limit} onChange={(event) => setApiForm((current) => ({ ...current, limit: event.target.value }))} />
                  </label>
                </div>
                <label>
                  <span>Search Query</span>
                  <input type="text" value={apiForm.query} placeholder="e.g. Interstellar" onChange={(event) => setApiForm((current) => ({ ...current, query: event.target.value }))} />
                </label>
                <button className="btn-primary" type="submit" disabled={busy === 'api'}>
                  {busy === 'api' ? 'Importing...' : 'Import Into Supabase'}
                </button>
              </form>
            </article>

            <article className="devlab-card">
              <h3>URL Scraping</h3>
              <p className="devlab-muted">Pull a remote page into the knowledge base with optional tagging and media context.</p>
              <form className="devlab-form" onSubmit={handleUrlIngest}>
                <label>
                  <span>URL</span>
                  <input type="url" value={urlForm.url} placeholder="https://example.com/article" onChange={(event) => setUrlForm((current) => ({ ...current, url: event.target.value }))} />
                </label>
                <div className="devlab-form-grid devlab-form-grid--two">
                  <label>
                    <span>Title Override</span>
                    <input type="text" value={urlForm.title} onChange={(event) => setUrlForm((current) => ({ ...current, title: event.target.value }))} />
                  </label>
                  <label>
                    <span>Media Type</span>
                    <select value={urlForm.mediaType} onChange={(event) => setUrlForm((current) => ({ ...current, mediaType: event.target.value }))}>
                      <option value="">General</option>
                      <option value="movie">Movie</option>
                      <option value="tv_show">TV Show</option>
                      <option value="book">Book</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>Tags</span>
                  <input type="text" value={urlForm.tags} placeholder="comma-separated tags" onChange={(event) => setUrlForm((current) => ({ ...current, tags: event.target.value }))} />
                </label>
                <button className="btn-primary" type="submit" disabled={busy === 'url'}>
                  {busy === 'url' ? 'Scraping...' : 'Scrape Into Knowledge Base'}
                </button>
              </form>
            </article>

            <article className="devlab-card devlab-card--full">
              <h3>Manual Text Or File Upload</h3>
              <p className="devlab-muted">Paste notes, upload small text files, and save the result straight into the knowledge collection.</p>
              <form className="devlab-form" onSubmit={handleManualIngest}>
                <div className="devlab-form-grid devlab-form-grid--two">
                  <label>
                    <span>Title</span>
                    <input type="text" value={manualForm.title} onChange={(event) => setManualForm((current) => ({ ...current, title: event.target.value }))} />
                  </label>
                  <label>
                    <span>Source Label</span>
                    <input type="text" value={manualForm.sourceLabel} onChange={(event) => setManualForm((current) => ({ ...current, sourceLabel: event.target.value }))} />
                  </label>
                </div>
                <div className="devlab-form-grid devlab-form-grid--two">
                  <label>
                    <span>Media Type</span>
                    <select value={manualForm.mediaType} onChange={(event) => setManualForm((current) => ({ ...current, mediaType: event.target.value }))}>
                      <option value="">General</option>
                      <option value="movie">Movie</option>
                      <option value="tv_show">TV Show</option>
                      <option value="book">Book</option>
                    </select>
                  </label>
                  <label>
                    <span>Tags</span>
                    <input type="text" value={manualForm.tags} placeholder="comma-separated tags" onChange={(event) => setManualForm((current) => ({ ...current, tags: event.target.value }))} />
                  </label>
                </div>
                <label>
                  <span>Optional File</span>
                  <input type="file" accept=".txt,.md,.json,.csv" onChange={handleFileUpload} />
                </label>
                <label>
                  <span>Content</span>
                  <textarea rows={8} value={manualForm.content} onChange={(event) => setManualForm((current) => ({ ...current, content: event.target.value }))} />
                </label>
                <button className="btn-primary" type="submit" disabled={busy === 'manual'}>
                  {busy === 'manual' ? 'Saving...' : 'Save Knowledge Document'}
                </button>
              </form>
            </article>
          </div>
        </section>

        <section className="home-section surface-panel">
          <div className="section-header">
            <div>
              <h2>Knowledge Documents</h2>
              <p className="home-panel-copy">Review the material already available to prompt previews and evaluation runs.</p>
            </div>
            <p className="surface-panel-meta">{dashboard.knowledge.length} loaded</p>
          </div>

          <div className="devlab-list">
            {dashboard.knowledge.length ? (
              dashboard.knowledge.map((document) => (
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
                    <button className="btn-ghost btn-ghost--danger" type="button" onClick={() => handleDeleteKnowledge(document.id)} disabled={busy === `knowledge-${document.id}`}>
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <p>No knowledge documents saved yet.</p>
                <p className="empty-hint">Use the intake tools above to seed the assistant context.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderRequestsSection() {
    return (
      <div className="devlab-section-stack">
        <section className="home-section surface-panel">
          <div className="section-header">
            <div>
              <h2>Media Requests</h2>
              <p className="home-panel-copy">This is the old admin-requests workflow, now folded into the developer lab so approval and ingestion live together.</p>
            </div>
            <p className="surface-panel-meta">Alias: /admin/requests</p>
          </div>

          <div className="tabs devlab-request-tabs">
            {REQUEST_FILTERS.map((filterValue) => (
              <button key={filterValue} className={`tab-btn ${requestFilter === filterValue ? 'active' : ''}`} onClick={() => setRequestFilter(filterValue)} type="button">
                {formatRequestFilterLabel(filterValue)}
                {filterValue !== 'all' && requestCounts[filterValue] ? ` (${requestCounts[filterValue]})` : ''}
              </button>
            ))}
          </div>

          {requestsLoading ? (
            <div className="loading-state">Loading requests...</div>
          ) : requests.length === 0 ? (
            <div className="empty-state">
              <p>No {requestFilter !== 'all' ? requestFilter : ''} requests.</p>
              <p className="empty-hint">New user submissions will show up here automatically.</p>
            </div>
          ) : (
            <div className="devlab-list">
              {requests.map((request) => (
                <div key={request.id} className="devlab-list-item devlab-request-card">
                  <div className="devlab-list-copy">
                    <div className="devlab-request-title-row">
                      <div className="devlab-request-heading">
                        <span className="devlab-request-icon">{REQUEST_MEDIA_ICONS[request.media_type] || 'Title'}</span>
                        <div>
                          <strong>{request.title}</strong>
                          <div className="devlab-request-meta">
                            <span>@{request.username}</span>
                            <span>{formatTime(request.created_at)}</span>
                            <span>{String(request.media_type || '').replace('_', ' ')}</span>
                            {request.year ? <span>{request.year}</span> : null}
                          </div>
                        </div>
                      </div>
                      <span className={`devlab-chip devlab-chip--${request.status}`}>{request.status}</span>
                    </div>

                    {request.reason ? <p className="devlab-request-quote">"{request.reason}"</p> : null}
                    {request.admin_note ? <p className="devlab-request-note">Admin note: {request.admin_note}</p> : null}

                    {requestNoteFor === request.id ? (
                      <div className="devlab-request-note-row">
                        <input className="search-input" placeholder="Optional note to the requester" value={requestAdminNote} onChange={(event) => setRequestAdminNote(event.target.value)} />
                        <button className="btn-ghost btn-ghost--danger" type="button" disabled={requestActionId === request.id} onClick={() => handleUpdateRequestStatus(request.id, 'rejected')}>
                          Confirm Reject
                        </button>
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => {
                            setRequestNoteFor(null);
                            setRequestAdminNote('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="devlab-list-actions devlab-request-actions">
                    {request.status === 'pending' ? (
                      <>
                        <button className="btn-primary btn-sm" type="button" disabled={requestActionId === request.id} onClick={() => handleUpdateRequestStatus(request.id, 'approved')}>
                          Approve
                        </button>
                        <button
                          className="btn-secondary btn-sm"
                          type="button"
                          disabled={requestActionId === request.id}
                          onClick={() => {
                            const isOpen = requestNoteFor === request.id;
                            setRequestNoteFor(isOpen ? null : request.id);
                            setRequestAdminNote(isOpen ? '' : request.admin_note || '');
                          }}
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button className="btn-ghost btn-sm" type="button" disabled={requestActionId === request.id} onClick={() => handleUpdateRequestStatus(request.id, 'pending')}>
                        Reset To Pending
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderPromptingSection() {
    if (loading) {
      return <div className="loading-state">Loading the developer lab...</div>;
    }

    return (
      <div className="devlab-section-stack">
        <section className="home-section surface-panel">
          <div className="section-header">
            <div>
              <h2>Prompt Profiles</h2>
              <p className="home-panel-copy">Tune how the assistant behaves per intent without digging through server files.</p>
            </div>
            <p className="surface-panel-meta">{promptOptions.length} intents</p>
          </div>

          {selectedPrompt ? (
            <form className="devlab-form" onSubmit={handlePromptSave}>
              <label>
                <span>Intent</span>
                <select value={selectedIntent} onChange={(event) => setSelectedIntent(event.target.value)}>
                  {promptOptions.map((intent) => (
                    <option key={intent} value={intent}>
                      {intent}
                    </option>
                  ))}
                </select>
              </label>
              <div className="devlab-form-grid">
                <label>
                  <span>Label</span>
                  <input type="text" value={selectedPrompt.label} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], label: event.target.value } }))} />
                </label>
                <label>
                  <span>Temperature</span>
                  <input type="number" min="0" max="1" step="0.05" value={selectedPrompt.temperature} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], temperature: event.target.value } }))} />
                </label>
                <label>
                  <span>Max Titles</span>
                  <input type="number" min="1" max="12" value={selectedPrompt.maxTitles} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], maxTitles: event.target.value } }))} />
                </label>
              </div>
              <label>
                <span>Description</span>
                <input type="text" value={selectedPrompt.description} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], description: event.target.value } }))} />
              </label>
              <label>
                <span>System Prompt</span>
                <textarea rows={10} value={selectedPrompt.systemPrompt} onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedIntent]: { ...current[selectedIntent], systemPrompt: event.target.value } }))} />
              </label>
              <button className="btn-primary" type="submit" disabled={busy === 'prompt'}>
                {busy === 'prompt' ? 'Saving...' : 'Save Prompt Profile'}
              </button>
            </form>
          ) : (
            <div className="empty-state">
              <p>No prompt profiles available.</p>
            </div>
          )}
        </section>

        <section className="home-section surface-panel">
          <div className="section-header">
            <div>
              <h2>Prompt Preview</h2>
              <p className="home-panel-copy">Run the current prompt stack against the Supabase dev function flow and inspect the generated context.</p>
            </div>
          </div>

          <form className="devlab-form" onSubmit={handlePreview}>
            <div className="devlab-form-grid devlab-form-grid--two">
              <label>
                <span>Intent</span>
                <select value={previewForm.forcedIntent} onChange={(event) => setPreviewForm((current) => ({ ...current, forcedIntent: event.target.value }))}>
                  <option value="auto">Auto-detect</option>
                  {INTENTS.map((intent) => (
                    <option key={intent} value={intent}>
                      {intent}
                    </option>
                  ))}
                </select>
              </label>
              <label className="devlab-inline-checkbox">
                <input type="checkbox" checked={previewForm.includeWebSearch} onChange={(event) => setPreviewForm((current) => ({ ...current, includeWebSearch: event.target.checked }))} />
                <span>Include web search</span>
              </label>
            </div>
            <label>
              <span>Question</span>
              <textarea rows={5} value={previewForm.question} placeholder="Ask the preview assistant a question" onChange={(event) => setPreviewForm((current) => ({ ...current, question: event.target.value }))} />
            </label>
            <button className="btn-primary" type="submit" disabled={busy === 'preview'}>
              {busy === 'preview' ? 'Generating...' : 'Run Preview'}
            </button>
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
        </section>
      </div>
    );
  }

  function renderQualitySection() {
    if (loading) {
      return <div className="loading-state">Loading the developer lab...</div>;
    }

    return (
      <div className="devlab-section-stack">
        <section className="home-section surface-panel">
          <div className="section-header">
            <div>
              <h2>Evaluation Cases</h2>
              <p className="home-panel-copy">Save recurring checks and run them against the current prompt and knowledge stack.</p>
            </div>
            <p className="surface-panel-meta">{dashboard.evalCases.length} saved</p>
          </div>

          <form className="devlab-form" onSubmit={handleEvalSave}>
            <label>
              <span>Label</span>
              <input type="text" value={evalForm.label} onChange={(event) => setEvalForm((current) => ({ ...current, label: event.target.value }))} />
            </label>
            <label>
              <span>Question</span>
              <textarea rows={3} value={evalForm.question} onChange={(event) => setEvalForm((current) => ({ ...current, question: event.target.value }))} />
            </label>
            <div className="devlab-form-grid">
              <label>
                <span>Expected Intent</span>
                <select value={evalForm.expectedIntent} onChange={(event) => setEvalForm((current) => ({ ...current, expectedIntent: event.target.value }))}>
                  <option value="">No intent check</option>
                  {INTENTS.map((intent) => (
                    <option key={intent} value={intent}>
                      {intent}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Expected Phrases</span>
                <textarea rows={3} value={evalForm.expectedPhrases} placeholder="one phrase per line" onChange={(event) => setEvalForm((current) => ({ ...current, expectedPhrases: event.target.value }))} />
              </label>
              <label>
                <span>Forbidden Phrases</span>
                <textarea rows={3} value={evalForm.forbiddenPhrases} placeholder="one phrase per line" onChange={(event) => setEvalForm((current) => ({ ...current, forbiddenPhrases: event.target.value }))} />
              </label>
            </div>
            <label>
              <span>Notes</span>
              <input type="text" value={evalForm.notes} onChange={(event) => setEvalForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <div className="devlab-button-row">
              <button className="btn-primary" type="submit" disabled={busy === 'eval-save'}>
                {busy === 'eval-save' ? 'Saving...' : 'Save Eval Case'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => handleRunEvals([])} disabled={busy === 'eval-all' || !dashboard.evalCases.length}>
                {busy === 'eval-all' ? 'Running...' : 'Run All Cases'}
              </button>
            </div>
          </form>

          <div className="devlab-list-block">
            <h3>Saved Cases</h3>
            <div className="devlab-list">
              {dashboard.evalCases.length ? (
                dashboard.evalCases.map((testCase) => (
                  <div key={testCase.id} className="devlab-list-item">
                    <div className="devlab-list-copy">
                      <strong>{testCase.label}</strong>
                      <p>{testCase.question}</p>
                      <p className="devlab-muted">{(testCase.expectedPhrases || []).join(', ') || 'No expected phrases'}</p>
                    </div>
                    <div className="devlab-list-actions">
                      <button className="btn-ghost" type="button" onClick={() => handleRunEvals([testCase.id])} disabled={busy === `eval-${testCase.id}`}>
                        {busy === `eval-${testCase.id}` ? 'Running...' : 'Run'}
                      </button>
                      <button className="btn-ghost btn-ghost--danger" type="button" onClick={() => handleDeleteEvalCase(testCase.id)} disabled={busy === `case-${testCase.id}`}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <p>No evaluation cases saved yet.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="home-section surface-panel">
          <div className="section-header">
            <div>
              <h2>Recent Runs</h2>
              <p className="home-panel-copy">Keep an eye on pass/fail trends and the intent selected by the latest eval executions.</p>
            </div>
            <p className="surface-panel-meta">{dashboard.evalRuns.length} recent</p>
          </div>

          <div className="devlab-list">
            {dashboard.evalRuns.length ? (
              dashboard.evalRuns.map((run) => (
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
              ))
            ) : (
              <div className="empty-state">
                <p>No evaluation runs yet.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderActiveSection() {
    if (activeSection === 'requests') return renderRequestsSection();
    if (activeSection === 'prompting') return renderPromptingSection();
    if (activeSection === 'quality') return renderQualitySection();
    return renderWorkspaceSection();
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content devlab-page">
        <div className="page-header">
          <p className="page-kicker">Operations</p>
          <h1>Developer Lab</h1>
          <p className="page-subtitle">One hidden workspace for catalog imports, knowledge ingestion, request review, prompt tuning, and evaluation checks across the Supabase-backed assistant workflow.</p>
        </div>

        <div className="stats-row devlab-stats-row">
          <div className="stat-card"><div className="stat-number">{dashboard.counts.movie_count}</div><div className="stat-label">Movies</div></div>
          <div className="stat-card"><div className="stat-number">{dashboard.counts.tv_count}</div><div className="stat-label">TV Shows</div></div>
          <div className="stat-card"><div className="stat-number">{dashboard.counts.book_count}</div><div className="stat-label">Books</div></div>
          <div className="stat-card"><div className="stat-number">{dashboard.counts.knowledge_count}</div><div className="stat-label">Knowledge Docs</div></div>
          <div className="stat-card"><div className="stat-number">{dashboard.counts.eval_case_count}</div><div className="stat-label">Eval Cases</div></div>
          <div className="stat-card"><div className="stat-number">{requestCounts.pending}</div><div className="stat-label">Pending Requests</div></div>
        </div>

        {(status || bannerError) ? (
          <section className="devlab-banner-row">
            {status ? <div className="devlab-banner devlab-banner--success">{status}</div> : null}
            {bannerError ? <div className="devlab-banner devlab-banner--error">{bannerError}</div> : null}
          </section>
        ) : null}

        <section className="home-section surface-panel">
          <div className="section-header">
            <div>
              <h2>{currentSection.title}</h2>
              <p className="home-panel-copy">{currentSection.description}</p>
            </div>
            <p className="surface-panel-meta">{activeSection === 'requests' ? 'Shared alias: /admin/requests' : 'Hidden route: /__ops/dev-lab'}</p>
          </div>
          <div className="tabs devlab-tabs">
            {SECTION_TABS.map((tab) => (
              <button key={tab.id} className={`tab-btn ${activeSection === tab.id ? 'active' : ''}`} onClick={() => selectSection(tab.id)} type="button">
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {renderActiveSection()}
      </main>
    </div>
  );
}
