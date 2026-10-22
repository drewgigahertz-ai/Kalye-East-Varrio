const fallbackFavicon = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#142646"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="Arial,sans-serif" font-size="35" font-weight="700" fill="#8dbaff">K</text></svg>'
);

function sendFallback(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return response.status(200).send(fallbackFavicon);
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).end();
  }

  const endpoint = process.env.APPS_SCRIPT_API_URL;
  if (!endpoint) return sendFallback(response);

  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch (error) {
    console.error('Favicon could not load the Apps Script logo: invalid APPS_SCRIPT_API_URL.');
    return sendFallback(response);
  }
  if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[^/]+\/exec\/?$/.test(parsedEndpoint.pathname)) {
    console.error('Favicon could not load the Apps Script logo: invalid APPS_SCRIPT_API_URL.');
    return sendFallback(response);
  }

  try {
    const upstream = await fetch(parsedEndpoint.toString(), {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'getBranding', args: [] })
    });
    if (!upstream.ok) {
      console.error('Favicon logo request failed with HTTP ' + upstream.status + '.');
      return sendFallback(response);
    }

    const payload = await upstream.json();
    const dataUri = payload && payload.result && payload.result.logo;
    const match = typeof dataUri === 'string' &&
      dataUri.match(/^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=\r\n]+)$/i);
    if (!match) {
      if (payload && payload.error) console.error('Favicon logo request failed:', payload.error);
      return sendFallback(response);
    }

    const image = Buffer.from(match[2], 'base64');
    if (!image.length) {
      console.error('Favicon logo request returned an empty image.');
      return sendFallback(response);
    }

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', match[1].toLowerCase());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'HEAD') return response.status(200).end();
    return response.status(200).send(image);
  } catch (error) {
    console.error('Favicon logo request failed:', error);
    return sendFallback(response);
  }
};
