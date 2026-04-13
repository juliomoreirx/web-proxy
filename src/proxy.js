const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { rewriteHTML, rewriteCSS } = require('./rewriter');

const getBrightDataAgent = () => {
  const { BRD_USER, BRD_PASS, BRD_HOST, BRD_PORT } = process.env;
  const proxyUrl = `http://${BRD_USER}:${BRD_PASS}@${BRD_HOST}:${BRD_PORT}`;
  return new HttpsProxyAgent(proxyUrl);
};

const getBrowserHeaders = (targetUrl, extraHeaders = {}) => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': targetUrl,
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  ...extraHeaders,
});

const BLOCKED_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'strict-transport-security',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
];

const handleProxyRequest = async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Parâmetro "url" é obrigatório.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'URL inválida.' });
  }

  console.log(`[PROXY] ${req.method} ${targetUrl}`);

  try {
    const agent = getBrightDataAgent();

    // Repassa cookies que vieram do browser
    const extraHeaders = {};
    if (req.headers.cookie) {
      extraHeaders['Cookie'] = req.headers.cookie;
    }

    const response = await axios({
      method: req.method,
      url: targetUrl,
      httpsAgent: agent,
      httpAgent: agent,
      headers: getBrowserHeaders(targetUrl, extraHeaders),
      data: req.method === 'POST' ? req.body : undefined,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 10,
      validateStatus: () => true,
    });

    const contentType = response.headers['content-type'] || '';

    // Repassa cookies de volta pro browser
    if (response.headers['set-cookie']) {
      const cookies = response.headers['set-cookie'].map(cookie =>
        cookie
          .replace(/Domain=[^;]+;?/gi, '')
          .replace(/SameSite=(Strict|Lax)/gi, 'SameSite=None')
          + '; Secure'
      );
      res.setHeader('Set-Cookie', cookies);
    }

    // Repassa headers seguros
    Object.keys(response.headers).forEach((key) => {
      if (!BLOCKED_HEADERS.includes(key.toLowerCase()) && key.toLowerCase() !== 'set-cookie') {
        res.setHeader(key, response.headers[key]);
      }
    });

    // Headers que permitem tudo
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.status(response.status);

    // HTML — reescreve links
    if (contentType.includes('text/html')) {
      const html = response.data.toString('utf-8');
      const rewritten = rewriteHTML(html, parsedUrl.origin, parsedUrl.href, req);
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').send(rewritten);
    }

    // CSS — reescreve url() internos
    if (contentType.includes('text/css')) {
      const css = response.data.toString('utf-8');
      const rewritten = rewriteCSS(css, parsedUrl.origin, req);
      return res.setHeader('Content-Type', 'text/css; charset=utf-8').send(rewritten);
    }

    // JavaScript — repassa direto
    if (contentType.includes('javascript')) {
      return res.setHeader('Content-Type', contentType).send(response.data);
    }

    // Tudo mais (imagens, fontes, etc.) — buffer direto
    return res.send(response.data);

  } catch (error) {
    console.error(`[PROXY ERROR] ${error.message}`);
    return res.status(502).json({
      error: 'Falha ao acessar o recurso.',
      detail: error.message,
    });
  }
};

module.exports = { handleProxyRequest };