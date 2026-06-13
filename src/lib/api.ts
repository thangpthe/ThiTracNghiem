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
