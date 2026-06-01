import api from './api';

/**
 * Subscribe an email to the WeRgame newsletter (public API).
 * @param {string} email
 * @param {string} [source] - e.g. 'footer', 'partner-site'
 */
export async function subscribeToNewsletter(email, source = 'website') {
  const { data } = await api.post('/newsletter/subscribe', {
    email: String(email || '').trim().toLowerCase(),
    source,
  });
  return data;
}
