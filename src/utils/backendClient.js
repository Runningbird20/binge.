import { normalizeMediaId } from './mediaId';
import { getActiveProfileId } from './activeProfile';

export const standaloneMode = true;
const listeners = new Set();
let sessionPromise = null;

export async function backendRequest(path, { method = 'GET', body, raw = false } = {}) {
  try {
    const profile = getActiveProfileId();
    const response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Binge-Request': '1',
        ...(profile ? { 'X-Binge-Profile': profile } : {}),
        ...(!raw && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    // SQL IDs are strings; preserve safe-number compatibility with existing cards.
    const normalize = (value) => {
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            key,
            (key === 'id' || key === 'media_id') && typeof entry === 'string' && /^\d+$/.test(entry)
              ? normalizeMediaId(entry)
              : normalize(entry),
          ])
        );
      }
      return value;
    };
    if (result.data) result.data = normalize(result.data);
    if (!response.ok) {
      return {
        data: null,
        error: typeof result.error === 'object' ? result.error : { message: result.error || 'Request failed.', status: response.status },
      };
    }
    return result;
  } catch {
    return { data: null, error: { message: 'Unable to reach the server. Please try again.' } };
  }
}

function notify(event, sessionData) {
  listeners.forEach((fn) => {
    Promise.resolve(fn(event, sessionData)).catch(() => {});
  });
}

class Query {
  constructor(table) {
    this.input = { table, action: 'select', filters: [], orders: [] };
  }
  select(fields = '*', options = {}) {
    this.input.fields = fields;
    this.input.options = options;
    return this;
  }
  insert(values) {
    this.input.action = 'insert';
    this.input.values = values;
    return this;
  }
  upsert(values, options = {}) {
    this.input.action = 'upsert';
    this.input.values = values;
    this.input.conflict = options.onConflict;
    return this;
  }
  update(values) {
    this.input.action = 'update';
    this.input.values = values;
    return this;
  }
  delete() {
    this.input.action = 'delete';
    return this;
  }
  eq(column, value) {
    return this.filter('eq', column, value);
  }
  neq(column, value) {
    return this.filter('neq', column, value);
  }
  gt(column, value) {
    return this.filter('gt', column, value);
  }
  gte(column, value) {
    return this.filter('gte', column, value);
  }
  lt(column, value) {
    return this.filter('lt', column, value);
  }
  lte(column, value) {
    return this.filter('lte', column, value);
  }
  ilike(column, value) {
    return this.filter('ilike', column, value);
  }
  like(column, value) {
    return this.filter('like', column, value);
  }
  is(column, value) {
    return this.filter('is', column, value);
  }
  in(column, value) {
    return this.filter('in', column, value);
  }
  not(column, operator, value) {
    this.input.filters.push({ op: 'not', column, operator, value });
    return this;
  }
  or(value) {
    this.input.filters.push({ op: 'or', value });
    return this;
  }
  filter(op, column, value) {
    this.input.filters.push({ op, column, value });
    return this;
  }
  order(column, options = {}) {
    this.input.orders.push({ column, ...options });
    return this;
  }
  range(start, end) {
    this.input.offset = start;
    this.input.limit = end - start + 1;
    return this;
  }
  limit(limit) {
    this.input.limit = limit;
    return this;
  }
  single() {
    this.input.single = 'required';
    return this;
  }
  maybeSingle() {
    this.input.single = 'optional';
    return this;
  }
  then(resolve, reject) {
    if (!this.promise) {
      this.promise = backendRequest('/backend/query', { method: 'POST', body: this.input });
    }
    return this.promise.then(resolve, reject);
  }
  catch(reject) {
    return this.then(undefined, reject);
  }
}

async function session() {
  if (!sessionPromise) {
    sessionPromise = backendRequest('/backend/auth/session').finally(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

export function createBackendClient({ admin = false } = {}) {
  const auth = {
    getSession: session,
    refreshSession: session,
    getUser: async () => {
      const result = await session();
      return { data: { user: result.data?.session?.user || null }, error: result.error };
    },
    signInWithPassword: async (body) => {
      const result = await backendRequest('/backend/auth/login', { method: 'POST', body });
      if (!result.error) notify('SIGNED_IN', result.data?.session);
      return result;
    },
    signUp: async (body) => {
      const result = await backendRequest(admin ? '/admin/users' : '/backend/auth/signup', { method: 'POST', body });
      if (!admin && !result.error) notify('SIGNED_IN', result.data?.session);
      return result;
    },
    signOut: async () => {
      const result = await backendRequest('/backend/auth/logout', { method: 'POST', body: {} });
      if (!result.error) notify('SIGNED_OUT', null);
      return result;
    },
    updateUser: async (body) => {
      const result = await backendRequest('/backend/auth/user', { method: 'PATCH', body });
      if (!result.error) {
        const current = await session();
        notify('USER_UPDATED', current.data?.session);
      }
      return result;
    },
    resetPasswordForEmail: (email) => backendRequest('/backend/auth/password-reset', { method: 'POST', body: { email } }),
    onAuthStateChange: (fn) => {
      listeners.add(fn);
      return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
    },
  };
  return {
    auth,
    from: (table) => new Query(table),
    storage: {
      from: (bucket) => ({
        upload: (name, file) =>
          backendRequest(
            `/backend/assets/${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`,
            { method: 'PUT', body: file, raw: true }
          ),
        getPublicUrl: (name) => ({
          data: {
            publicUrl: `/api/backend/assets/${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`,
          },
        }),
      }),
    },
  };
}

export const client = createBackendClient();
export const db = client;
export const supabase = client;
export const isSupabaseConfigured = true;
export const requireClient = () => client;
export const requireSupabaseClient = () => client;
export const getSessionlessClient = () => createBackendClient({ admin: true });
export const getSessionlessSupabaseClient = () => createBackendClient({ admin: true });
export const getSession = () => session();
export const getSupabaseSession = () => session();
export const getUser = async () => {
  const result = await session();
  return { data: { user: result.data?.session?.user || null }, error: result.error };
};
export const getSupabaseUser = getUser;
export const refreshSession = () => session();
export const refreshSupabaseSession = () => session();
export function toBackendError(error, fallbackMessage) {
  if (!error) return new Error(fallbackMessage);
  return new Error(error.message || fallbackMessage);
}
export const toSupabaseError = toBackendError;
