const cheerio = require('cheerio');

/**
 * Converte uma URL relativa em absoluta com base na origem do site
 */
const toAbsolute = (url, origin) => {
  if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) {
    return url;
  }
  try {
    return new URL(url, origin).href;
  } catch {
    return url;
  }
};

/**
 * Gera a URL que passa pelo nosso proxy
 */
const toProxyUrl = (absoluteUrl, req) => {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
};

/**
 * Reescreve todo o HTML para que recursos e links passem pelo proxy
 */
const rewriteHTML = (html, origin, req) => {
  const $ = cheerio.load(html, { decodeEntities: false });

  // Reescreve <a href="...">
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const absolute = toAbsolute(href, origin);
    if (absolute && absolute.startsWith('http')) {
      $(el).attr('href', toProxyUrl(absolute, req));
    }
  });

  // Reescreve <link rel="stylesheet" href="...">
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    const absolute = toAbsolute(href, origin);
    if (absolute && absolute.startsWith('http')) {
      $(el).attr('href', toProxyUrl(absolute, req));
    }
  });

  // Reescreve <script src="...">
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    const absolute = toAbsolute(src, origin);
    if (absolute && absolute.startsWith('http')) {
      $(el).attr('src', toProxyUrl(absolute, req));
    }
  });

  // Reescreve <img src="..."> e <img srcset="...">
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    const absolute = toAbsolute(src, origin);
    if (absolute && absolute.startsWith('http')) {
      $(el).attr('src', toProxyUrl(absolute, req));
    }
  });

  $('img[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset');
    const rewritten = srcset.split(',').map((part) => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const absolute = toAbsolute(url, origin);
      const proxied = absolute?.startsWith('http') ? toProxyUrl(absolute, req) : url;
      return descriptor ? `${proxied} ${descriptor}` : proxied;
    }).join(', ');
    $(el).attr('srcset', rewritten);
  });

  // Reescreve <source srcset="..."> (para <picture> e <video>)
  $('source[srcset]').each((_, el) => {
    const src = $(el).attr('srcset');
    const absolute = toAbsolute(src, origin);
    if (absolute?.startsWith('http')) {
      $(el).attr('srcset', toProxyUrl(absolute, req));
    }
  });

  // Reescreve <form action="...">
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action');
    const absolute = toAbsolute(action, origin);
    if (absolute?.startsWith('http')) {
      $(el).attr('action', toProxyUrl(absolute, req));
    }
  });

  // Injeta script para interceptar navegação dinâmica (SPA/AJAX)
  $('head').append(`
    <script>
      (function() {
        const PROXY_BASE = '/proxy?url=';
        const _open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          if (url && !url.startsWith('/proxy') && (url.startsWith('http') || url.startsWith('//'))) {
            url = PROXY_BASE + encodeURIComponent(url.startsWith('//') ? 'https:' + url : url);
          }
          return _open.call(this, method, url, ...rest);
        };

        const _fetch = window.fetch;
        window.fetch = function(input, init) {
          let url = typeof input === 'string' ? input : input.url;
          if (url && !url.startsWith('/proxy') && (url.startsWith('http') || url.startsWith('//'))) {
            url = PROXY_BASE + encodeURIComponent(url.startsWith('//') ? 'https:' + url : url);
            input = typeof input === 'string' ? url : new Request(url, input);
          }
          return _fetch(input, init);
        };
      })();
    </script>
  `);

  return $.html();
};

module.exports = { rewriteHTML, toAbsolute, toProxyUrl };