let isRedirecting = false;

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const options = init || {};
  options.credentials = 'same-origin';
  const response = await fetch(input, options);
  if (response.status === 401) {
    localStorage.removeItem('vision_grader_user');
    if (!isRedirecting && window.location.pathname !== '/') {
      isRedirecting = true;
      window.location.href = '/';
    }
  }
  return response;
}

/**
 * Shorthand for POST requests with JSON body.
 * Eliminates repeated { method, headers, body } boilerplate.
 */
export async function postJson<T = any>(url: string, payload?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  return res.json() as Promise<T>;
}
