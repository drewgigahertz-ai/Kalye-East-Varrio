const allowedMethods = new Set([
  'login',
  'logout',
  'getAppData',
  'getBranding',
  'saveFormField',
  'archiveFormField',
  'saveTransaction',
  'voidTransaction',
  'createMonitoring',
  'addMonitoringDate',
  'addMonitoringMember',
  'archiveMonitoring'
]);

const sessionCookieName = 'kev_session';

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Use POST for tracker operations.' });
  }

  const endpoint = process.env.APPS_SCRIPT_API_URL;
  if (!endpoint) {
    return response.status(500).json({ error: 'APPS_SCRIPT_API_URL is not configured in Vercel.' });
  }
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch (error) {
    return response.status(500).json({ error: 'APPS_SCRIPT_API_URL must be a valid Apps Script web app URL.' });
  }
  if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[^/]+\/exec\/?$/.test(parsedEndpoint.pathname)) {
    return response.status(500).json({ error: 'APPS_SCRIPT_API_URL must be the HTTPS URL ending in /macros/s/.../exec.' });
  }

  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.method !== 'string' || !allowedMethods.has(body.method) ||
      (body.args != null && (!Array.isArray(body.args) || body.args.length > 2)) ||
      (body.method === 'login' &&
        (!Array.isArray(body.args) || body.args.length !== 2 ||
          typeof body.args[0] !== 'string' || body.args[0].length > 120 ||
          typeof body.args[1] !== 'string' || body.args[1].length > 256))) {
    return response.status(400).json({ error: 'Invalid or unsupported tracker request.' });
  }

  const sessionToken = getCookie(request.headers && request.headers.cookie, sessionCookieName);
  if (body.method !== 'login' && body.method !== 'getBranding' && body.method !== 'logout' && !sessionToken) {
    return response.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
  if (body.method === 'logout' && !sessionToken) {
    setSessionCookie(response, '', request);
    return response.status(200).json({ result: { ok: true } });
  }
  if (body.method === 'logout') setSessionCookie(response, '', request);

  try {
    const upstream = await fetch(parsedEndpoint.toString(), {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: body.method,
        args: body.args || [],
        authToken: sessionToken || ''
      })
    });
    const responseText = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      return response.status(502).json({
        error: 'Apps Script did not return JSON. Confirm the web app is deployed with access set to Anyone.'
      });
    }
    if (!upstream.ok) {
      return response.status(502).json({ error: payload.error || 'The Apps Script service returned an error.' });
    }
    if (payload.error) {
      if (/session has expired|sign in again/i.test(payload.error)) {
        setSessionCookie(response, '', request);
        return response.status(401).json({ error: 'Your session has expired. Sign in again.' });
      }
      return response.status(400).json({ error: payload.error });
    }
    if (body.method === 'login') {
      const session = payload.result;
      if (!session || typeof session.token !== 'string' || !session.token || typeof session.user !== 'string') {
        return response.status(502).json({ error: 'The authentication service returned an invalid session.' });
      }
      setSessionCookie(response, session.token, request);
      return response.status(200).json({ result: { user: session.user } });
    }
    return response.status(200).json({ result: payload.result });
  } catch (error) {
    console.error('Apps Script request failed:', error);
    return response.status(502).json({ error: 'Could not reach the Apps Script backend. Check its deployment and URL.' });
  }
};

function getCookie(cookieHeader, name) {
  const cookie = String(cookieHeader || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='));
  return cookie ? cookie.slice(name.length + 1) : '';
}

function setSessionCookie(response, token, request) {
  const forwardedProtocol = request.headers && request.headers['x-forwarded-proto'];
  const secure = forwardedProtocol === 'https' || process.env.VERCEL === '1' ? '; Secure' : '';
  const maxAge = token ? 21600 : 0;
  response.setHeader('Set-Cookie',
    sessionCookieName + '=' + (token || '') + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + secure);
}

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb'
    }
  }
};
