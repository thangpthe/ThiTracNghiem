export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const options = init || {};
  const userStr = localStorage.getItem('vision_grader_user');
  
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${user.token}`,
        'x-auth-cccd': user.cccd,
        'x-auth-role': user.role
      };
    } catch(e) {}
  }
  
  return fetch(input, options);
}
