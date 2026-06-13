export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const options = init || {};
  options.credentials = 'same-origin';
  return fetch(input, options);
}
