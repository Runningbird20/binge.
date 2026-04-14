import { api } from '../api';
import { invokeSupabaseFunction, isSupabaseConfigured } from './supabase';

async function callDevFunction(action, payload = {}) {
  return invokeSupabaseFunction('dev', {
    action,
    ...payload,
  });
}

function shouldUseSupabaseDevLab() {
  return isSupabaseConfigured;
}

export const devLabApi = {
  getDashboard: () =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('dashboard')
      : api.get('/dev-lab/dashboard'),
  listKnowledge: () =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('knowledge:list')
      : api.get('/dev-lab/knowledge'),
  saveManualDocument: (payload) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('knowledge:create-manual', payload)
      : api.post('/dev-lab/ingest/manual', payload),
  scrapeUrlDocument: (payload) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('knowledge:scrape-url', payload)
      : api.post('/dev-lab/ingest/url', payload),
  importCatalogFromApi: (payload) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('catalog:import-api', payload)
      : api.post('/dev-lab/ingest/api', payload),
  savePromptProfile: (intent, payload) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('prompts:save', { intent, ...payload })
      : api.put(`/dev-lab/prompts/${encodeURIComponent(intent)}`, payload),
  previewPromptResponse: (payload) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('preview', payload)
      : api.post('/dev-lab/chat/preview', payload),
  listEvaluations: () =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('evaluations:list')
      : api.get('/dev-lab/evaluations'),
  createEvaluationCase: (payload) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('evaluations:create-case', payload)
      : api.post('/dev-lab/evaluations/cases', payload),
  runEvaluations: (payload) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('evaluations:run', payload)
      : api.post('/dev-lab/evaluations/run', payload),
  deleteKnowledgeDocument: (id) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('knowledge:delete', { id })
      : api.delete(`/dev-lab/knowledge/${id}`),
  deleteEvaluationCase: (id) =>
    shouldUseSupabaseDevLab()
      ? callDevFunction('evaluations:delete-case', { id })
      : api.delete(`/dev-lab/evaluations/cases/${id}`),
};
