const cheerio = require('cheerio');

const toAbsolute = (url, origin) => {
  if (!url) return url;
  url = url.trim();
  if (
    url.startsWith('data:') ||
    url.startsWith('javascript:') ||
    url.startsWith('mailto:') ||
    url.startsWith('#') ||
    url === ''
  ) return url;
  if (url.startsWith('//')) return 'https:' + url;
  try {
    return new URL(url, origin).href;
  } catch {
    return url;
  }
};

const toProxyUrl = (absoluteUrl, req) => {
  if (!absoluteUrl || !absoluteUrl.startsWith('http')) return absoluteUrl;
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
};

// Reescreve url() dentro de arquivos CSS
const rewriteCSS = (css, origin, req) => {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, url) => {
    const absolute = toAbsolute(url.trim(), origin);
    if (!absolute || !absolute.startsWith('http')) return match;
    const proxied = toProxyUrl(absolute, req);
    return `url(${quote}${proxied}${quote})`;
  });
};

const rewriteHTML = (html, origin, pageUrl, req) => {
  const $ = cheerio.load(html, { decodeEntities: false });

  // <base href> — remove para não interferir
  $('base').remove();

  // <a href>
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const abs = toAbsolute(href, origin);
    if (abs?.startsWith('http')) $(el).attr('href', toProxyUrl(abs, req));
  });

  // <link href> — CSS, favicon, etc.
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    const abs = toAbsolute(href, origin);
    if (abs?.startsWith('http')) $(el).attr('href', toProxyUrl(abs, req));
  });

  // <script src>
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    const abs = toAbsolute(src, origin);
    if (abs?.startsWith('http')) $(el).attr('src', toProxyUrl(abs, req));
  });

  // <img src e srcset>
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    const abs = toAbsolute(src, origin);
    if (abs?.startsWith('http')) $(el).attr('src', toProxyUrl(abs, req));
  });

  $('[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset');
    const rewritten = srcset.split(',').map(part => {
      const [url, ...rest] = part.trim().split(/\s+/);
      const abs = toAbsolute(url, origin);
      const proxied = abs?.startsWith('http') ? toProxyUrl(abs, req) : url;
      return [proxied, ...rest].join(' ');
    }).join(', ');
    $(el).attr('srcset', rewritten);
  });

  // <source src e srcset>
  $('source[src]').each((_, el) => {
    const src = $(el).attr('src');
    const abs = toAbsolute(src, origin);
    if (abs?.startsWith('http')) $(el).attr('src', toProxyUrl(abs, req));
  });

  // <video src>, <audio src>, <iframe src>
  $('video[src], audio[src], iframe[src]').each((_, el) => {
    const src = $(el).attr('src');
    const abs = toAbsolute(src, origin);
    if (abs?.startsWith('http')) $(el).attr('src', toProxyUrl(abs, req));
  });

  // <form action>
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action');
    const abs = toAbsolute(action, origin);
    if (abs?.startsWith('http')) $(el).attr('action', toProxyUrl(abs, req));
  });

  // style="background: url(...)" inline
  $('[style]').each((_, el) => {
    const style = $(el).attr('style');
    if (style?.includes('url(')) {
      $(el).attr('style', rewriteCSS(style, origin, req));
    }
  });

  // <style> tags inline
  $('style').each((_, el) => {
    const css = $(el).html();
    if (css) $(el).html(rewriteCSS(css, origin, req));
  });

  // meta refresh
  $('meta[http-equiv="refresh"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content) {
      const rewritten = content.replace(/url=(.+)/i, (_, url) => {
        const abs = toAbsolute(url.trim(), origin);
        return abs?.startsWith('http') ? `url=${toProxyUrl(abs, req)}` : `url=${url}`;
      });
      $(el).attr('content', rewritten);
    }
  });

  // Injeta script de interceptação dinâmica
  const proxyScript = `
<script>
(function() {
  const PROXY = '/proxy?url=';
  const BASE = '${origin}';

  function proxify(url) {
    if (!url || url.startsWith('/proxy') || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return url;
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.startsWith('/')) url = BASE + url;
    if (url.startsWith('http')) return PROXY + encodeURIComponent(url);
    return url;
  }

  // Intercepta XHR
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return _open.call(this, method, proxify(url), ...rest);
  };

  // Intercepta fetch
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = proxify(input);
    else if (input instanceof Request) {
      input = new Request(proxify(input.url), input);
    }
    return _fetch.call(window, input, init);
  };

  // Intercepta history pushState/replaceState
  const _push = history.pushState;
  history.pushState = function(state, title, url) {
    if (url && !url.startsWith('/proxy') && url.startsWith('http')) {
      url = PROXY + encodeURIComponent(url);
    }
    return _push.call(this, state, title, url);
  };

  // Intercepta criação dinâmica de elementos
  const _createElement = document.createElement.bind(document);
  document.createElement = function(tag, ...args) {
    const el = _createElement(tag, ...args);
    if (tag.toLowerCase() === 'script') {
      const desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      Object.defineProperty(el, 'src', {
        set(val) { desc.set.call(this, proxify(val)); },
        get() { return desc.get.call(this); }
      });
    }
    if (tag.toLowerCase() === 'img') {
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(el, 'src', {
        set(val) { desc.set.call(this, proxify(val)); },
        get() { return desc.get.call(this); }
      });
    }
    return el;
  };

  // Desregistra service workers que possam interferir
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
  }
})();
</script>`;

  $('head').prepend(proxyScript);

  return $.html();
};

module.exports = { rewriteHTML, rewriteCSS, toAbsolute, toProxyUrl };