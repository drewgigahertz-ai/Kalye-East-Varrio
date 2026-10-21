const allowedMethods = new Set([
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
      (body.args != null && (!Array.isArray(body.args) || body.args.length > 2))) {
    return response.status(400).json({ error: 'Invalid or unsupported tracker request.' });
  }

  try {
    const upstream = await fetch(parsedEndpoint.toString(), {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: body.method, args: body.args || [] })
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
    if (payload.error) return response.status(400).json({ error: payload.error });
    return response.status(200).json({ result: payload.result });
  } catch (error) {
    console.error('Apps Script request failed:', error);
    return response.status(502).json({ error: 'Could not reach the Apps Script backend. Check its deployment and URL.' });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb'
    }
  }
};
