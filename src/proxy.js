const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { rewriteHTML } = require('./rewriter');

// Monta a URL do proxy da Bright Data com autenticação
const getBrightDataAgent = () => {
  const { BRD_USER, BRD_PASS, BRD_HOST, BRD_PORT } = process.env;
  const proxyUrl = `http://${BRD_USER}:${BRD_PASS}@${BRD_HOST}:${BRD_PORT}`;
  return new HttpsProxyAgent(proxyUrl);
};

// Headers que simulam um browser real
const getBrowserHeaders = (targetUrl) => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': targetUrl,
  'Cache-Control': 'no-cache',
});

const handleProxyRequest = async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Parâmetro "url" é obrigatório.' });
  }

  // Validação básica de URL
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'URL inválida.' });
  }

  console.log(`[PROXY] Acessando: ${targetUrl}`);

  try {
    const agent = getBrightDataAgent();

    const response = await axios.get(targetUrl, {
      httpsAgent: agent,
      httpAgent: agent,
      headers: getBrowserHeaders(targetUrl),
      responseType: 'arraybuffer', // Importante: recebe tudo como buffer (imagens, etc.)
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true, // Não lança erro em 4xx/5xx
    });

    const contentType = response.headers['content-type'] || 'text/html';

    // Remove headers problemáticos antes de repassar
    const headersToRemove = [
      'content-security-policy',
      'x-frame-options',
      'strict-transport-security',
      'content-encoding', // Axios já descomprime
    ];

    Object.keys(response.headers).forEach((key) => {
      if (!headersToRemove.includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key]);
      }
    });

    res.status(response.status);

    // Se for HTML, reescreve os links para passar pelo proxy
    if (contentType.includes('text/html')) {
      const htmlContent = response.data.toString('utf-8');
      const rewritten = rewriteHTML(htmlContent, parsedUrl.origin, req);
      return res.send(rewritten);
    }

    // Para CSS, JS, imagens — repassa o buffer diretamente
    return res.send(response.data);

  } catch (error) {
    console.error(`[PROXY ERROR] ${error.message}`);
    const status = error.response?.status || 502;
    return res.status(status).json({
      error: 'Falha ao acessar o recurso.',
      detail: error.message,
    });
  }
};

module.exports = { handleProxyRequest };