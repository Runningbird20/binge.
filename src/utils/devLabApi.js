import { api } from '../api';

export const devLabApi = {
  getDashboard: () => api.get('/dev-lab/dashboard'),
  listKnowledge: () => api.get('/dev-lab/knowledge'),
  saveManualDocument: (payload) => api.post('/dev-lab/ingest/manual', payload),
  scrapeUrlDocument: (payload) => api.post('/dev-lab/ingest/url', payload),
  importCatalogFromApi: (payload) => api.post('/dev-lab/ingest/api', payload),
  savePromptProfile: (intent, payload) => api.put(`/dev-lab/prompts/${encodeURIComponent(intent)}`, payload),
  previewPromptResponse: (payload) => api.post('/dev-lab/chat/preview', payload),
  listEvaluations: () => api.get('/dev-lab/evaluations'),
  createEvaluationCase: (payload) => api.post('/dev-lab/evaluations/cases', payload),
  runEvaluations: (payload) => api.post('/dev-lab/evaluations/run', payload),
  deleteKnowledgeDocument: (id) => api.delete(`/dev-lab/knowledge/${id}`),
  deleteEvaluationCase: (id) => api.delete(`/dev-lab/evaluations/cases/${id}`),
};
