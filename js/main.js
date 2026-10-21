/* Eonova Hexo adapter: progressive enhancement, with no content rewriting. */
(() => {
  'use strict';

  const ready = (callback) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  };

  ready(() => {
    const root = document.documentElement;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const motionSubscribers = [];
    const scriptPromises = new Map();
    let config = {};
    try {
      config = JSON.parse(document.getElementById('site-config')?.textContent || '{}');
    } catch (error) {
      console.warn('The site configuration could not be read.', error);
    }

    const onMediaChange = (query, callback) => {
      if (query.addEventListener) query.addEventListener('change', callback);
      else query.addListener(callback);
    };
    onMediaChange(motion, () => motionSubscribers.forEach((callback) => callback()));

    function loadScript(src) {
      if (!src) return Promise.reject(new Error('Missing script URL.'));
      const url = new URL(src, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol)) return Promise.reject(new Error('Unsupported script URL.'));
      if (scriptPromises.has(url.href)) return scriptPromises.get(url.href);
      const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          script.onload = null;
          script.onerror = null;
          if (error) {
            script.remove();
            reject(error);
          } else resolve();
        };
        const timeout = window.setTimeout(() => finish(new Error('Script loading timed out.')), 20000);
        script.src = url.href;
        script.async = true;
        script.onload = () => finish();
        script.onerror = () => finish(new Error('Script loading failed.'));
        document.head.append(script);
      });
      scriptPromises.set(url.href, promise);
      promise.catch(() => scriptPromises.delete(url.href));
      return promise;
    }

    function setupDialog(dialog, closeSelector) {
      if (!dialog) return null;
      let opener = null;
      const returnFocus = () => {
        document.body.classList.toggle('dialog-open', Boolean(document.querySelector('dialog[open]')));
        if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
        opener = null;
      };
      const close = () => {
        if (!dialog.open) return;
        if (typeof dialog.close === 'function') dialog.close();
        else {
          dialog.removeAttribute('open');
          returnFocus();
        }
      };
      dialog.addEventListener('close', returnFocus);
      dialog.querySelectorAll(closeSelector).forEach((button) => button.addEventListener('click', close));
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      });
      dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      });
      return {
        open(trigger) {
          if (dialog.open) return;
          opener = trigger || document.activeElement;
          if (typeof dialog.showModal === 'function') dialog.showModal();
          else dialog.setAttribute('open', '');
          document.body.classList.add('dialog-open');
        },
        close
      };
    }

    function initTheme() {
      const preference = window.matchMedia('(prefers-color-scheme: dark)');
      const toggles = [...document.querySelectorAll('[data-theme-toggle]')];
      const stored = () => {
        try { return localStorage.getItem('eonova-theme'); } catch { return null; }
      };
      const apply = (theme, remember = false) => {
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
        toggles.forEach((button) => {
          const label = theme === 'dark' ? '切换至浅色模式' : '切换至深色模式';
          button.setAttribute('aria-label', label);
          button.setAttribute('title', label);
          button.setAttribute('aria-pressed', String(theme === 'dark'));
        });
        if (remember) {
          try { localStorage.setItem('eonova-theme', theme); } catch { /* Storage may be unavailable in private mode. */ }
        }
        window.dispatchEvent(new CustomEvent('eonova:themechange', { detail: { theme } }));
      };
      const saved = stored();
      const defaultTheme = () => ['light', 'dark'].includes(config.colorMode) ? config.colorMode : (preference.matches ? 'dark' : 'light');
      apply(saved === 'light' || saved === 'dark' ? saved : defaultTheme());
      toggles.forEach((button) => button.addEventListener('click', () => apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true)));
      onMediaChange(preference, () => {
        if (!['light', 'dark'].includes(stored())) apply(defaultTheme());
      });
      window.addEventListener('storage', (event) => {
        if (event.key === 'eonova-theme') apply(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : defaultTheme());
      });
    }

    let closeMenu = () => {};
    function initMenu() {
      const toggle = document.getElementById('menu-toggle');
      const menu = document.getElementById('mobile-menu');
      if (!toggle || !menu) return;
      const setOpen = (open, focus = false) => {
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
        document.body.classList.toggle('menu-open', open);
        if (open) document.getElementById('main-header')?.classList.remove('is-hidden');
        if (focus) (open ? menu.querySelector('a, button') : toggle)?.focus();
      };
      closeMenu = () => setOpen(false);
      setOpen(false);
      toggle.addEventListener('click', () => setOpen(menu.hidden));
      menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
      document.addEventListener('pointerdown', (event) => {
        if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !menu.hidden) setOpen(false, true);
      });
      onMediaChange(window.matchMedia('(min-width: 640px)'), (event) => { if (event.matches) closeMenu(); });
    }

    function initSearch() {
      const dialog = document.getElementById('search-dialog');
      const input = document.getElementById('search-input');
      const results = document.getElementById('search-results');
      const status = document.getElementById('search-status');
      if (!dialog || !input || !results || !status) return;
      const modal = setupDialog(dialog, '[data-search-close]');
      let index = null;
      let indexPromise = null;
      let debounce;
      let revision = 0;
      let activeIndex = -1;
      let resultLinks = [];
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      results.setAttribute('role', 'listbox');
      results.setAttribute('aria-label', '搜索结果');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-controls', 'search-results');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');

      const textOnly = (html) => new DOMParser().parseFromString(html, 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
      const articleUrl = (value) => {
        if (!value) return null;
        try {
          const url = new URL(value, document.baseURI);
          return ['http:', 'https:'].includes(url.protocol) ? url.pathname + url.search + url.hash : null;
        } catch { return null; }
      };
      const loadIndex = () => {
        if (index) return Promise.resolve(index);
        if (indexPromise) return indexPromise;
        indexPromise = (async () => {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 15000);
          try {
            const response = await fetch(config.searchUrl || '/search.xml', { signal: controller.signal, credentials: 'same-origin' });
            if (!response.ok) throw new Error(`Search index returned ${response.status}.`);
            const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
            if (xml.querySelector('parsererror')) throw new Error('The search index is not valid XML.');
            index = [...xml.querySelectorAll('entry')].map((entry) => {
              const title = (entry.querySelector('title')?.textContent || '未命名文章').replace(/\s+/g, ' ').trim();
              const content = textOnly(entry.querySelector('content')?.textContent || '');
              const url = articleUrl(entry.querySelector('url')?.textContent?.trim() || '');
              return { title, content, url, titleLower: title.toLowerCase(), contentLower: content.toLowerCase() };
            }).filter((entry) => entry.url);
            return index;
          } finally { clearTimeout(timeout); }
        })();
        indexPromise.catch(() => { indexPromise = null; });
        return indexPromise;
      };

      const clearResults = () => {
        results.replaceChildren();
        resultLinks = [];
        activeIndex = -1;
        input.removeAttribute('aria-activedescendant');
        input.setAttribute('aria-expanded', 'false');
      };
      const select = (position, scroll = false) => {
        if (!resultLinks.length) return;
        activeIndex = (position + resultLinks.length) % resultLinks.length;
        resultLinks.forEach((link, i) => {
          link.classList.toggle('is-active', i === activeIndex);
          link.setAttribute('aria-selected', String(i === activeIndex));
        });
        input.setAttribute('aria-activedescendant', resultLinks[activeIndex].id);
        if (scroll) resultLinks[activeIndex].scrollIntoView({ block: 'nearest', behavior: 'auto' });
      };
      const appendHighlighted = (container, text, terms) => {
        const lower = text.toLowerCase();
        let cursor = 0;
        while (cursor < text.length) {
          let next = -1;
          let length = 0;
          terms.forEach((term) => {
            const position = lower.indexOf(term, cursor);
            if (position >= 0 && (next < 0 || position < next || (position === next && term.length > length))) {
              next = position;
              length = term.length;
            }
          });
          if (next < 0) {
            container.append(document.createTextNode(text.slice(cursor)));
            break;
          }
          container.append(document.createTextNode(text.slice(cursor, next)));
          const mark = document.createElement('mark');
          mark.textContent = text.slice(next, next + length);
          container.append(mark);
          cursor = next + length;
        }
      };
      const excerpt = (entry, terms) => {
        const positions = terms.map((term) => entry.contentLower.indexOf(term)).filter((position) => position >= 0);
        const start = positions.length ? Math.max(0, Math.min(...positions) - 50) : 0;
        return (start ? '…' : '') + entry.content.slice(start, start + 180) + (entry.content.length > start + 180 ? '…' : '');
      };
      const search = async () => {
        const currentRevision = ++revision;
        const query = input.value.trim().toLowerCase();
        clearResults();
        status.replaceChildren(document.createTextNode(index ? (query ? '正在搜索…' : `输入标题或正文关键词，搜索 ${index.length} 篇文章。`) : '正在加载搜索索引…'));
        let entries;
        try { entries = await loadIndex(); } catch (error) {
          if (currentRevision !== revision) return;
          console.warn('Local search could not load.', error);
          status.textContent = '搜索索引暂时无法加载。';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'search-retry';
          retry.textContent = '重试';
          retry.addEventListener('click', search);
          status.append(' ', retry);
          return;
        }
        if (currentRevision !== revision) return;
        if (!entries.length) {
          status.textContent = '暂时没有公开文章。';
          return;
        }
        if (!query) {
          status.textContent = `输入标题或正文关键词，搜索 ${entries.length} 篇文章。`;
          return;
        }
        const terms = [...new Set(query.split(/\s+/).filter(Boolean))].slice(0, 12);
        const matches = entries.map((entry) => {
          if (!terms.every((term) => entry.titleLower.includes(term) || entry.contentLower.includes(term))) return null;
          const score = (entry.titleLower.includes(query) ? 50 : 0) + terms.reduce((sum, term) => sum + (entry.titleLower.includes(term) ? 10 : 1), 0);
          return { entry, score };
        }).filter(Boolean).sort((a, b) => b.score - a.score);
        status.textContent = matches.length ? `找到 ${matches.length} 篇文章${matches.length > 30 ? '，显示前 30 篇' : ''}。` : `没有找到与“${input.value.trim()}”相关的文章，请换个关键词。`;
        const fragment = document.createDocumentFragment();
        matches.slice(0, 30).forEach(({ entry }, i) => {
          const link = document.createElement('a');
          link.className = 'search-result';
          link.id = `search-result-${i}`;
          link.href = entry.url;
          link.setAttribute('role', 'option');
          link.setAttribute('aria-selected', 'false');
          link.tabIndex = -1;
          const title = document.createElement('span');
          title.className = 'search-result-title';
          appendHighlighted(title, entry.title, terms);
          const description = document.createElement('span');
          description.className = 'search-result-excerpt';
          appendHighlighted(description, excerpt(entry, terms), terms);
          link.append(title, description);
          link.addEventListener('pointerenter', () => select(i));
          link.addEventListener('click', modal.close);
          resultLinks.push(link);
          fragment.append(link);
        });
        results.append(fragment);
        input.setAttribute('aria-expanded', String(resultLinks.length > 0));
        select(0);
      };
      const open = (trigger) => {
        closeMenu();
        modal.open(trigger);
        input.focus({ preventScroll: true });
        search();
      };
      document.querySelectorAll('[data-search-open]').forEach((button) => button.addEventListener('click', () => open(button)));
      input.addEventListener('input', () => {
        ++revision;
        clearTimeout(debounce);
        clearResults();
        debounce = window.setTimeout(search, 100);
      });
      input.addEventListener('keydown', (event) => {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          select(activeIndex + (event.key === 'ArrowDown' ? 1 : -1), true);
        } else if (event.key === 'Enter' && resultLinks[activeIndex]) {
          event.preventDefault();
          resultLinks[activeIndex].click();
        }
      });
      document.addEventListener('keydown', (event) => {
        if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          if (dialog.open) input.focus();
          else open(document.activeElement);
        }
      });
    }

    function initCode() {
      const article = document.querySelector('.post-content');
      if (!article) return;
      const blocks = [...article.querySelectorAll('figure.highlight, pre')].filter((block) => block.matches('figure.highlight') || !block.closest('figure.highlight'));
      const writeClipboard = async (text) => {
        if (navigator.clipboard?.writeText) {
          try { await navigator.clipboard.writeText(text); return; } catch { /* Use the selection fallback when permission is unavailable. */ }
        }
        const previous = document.activeElement;
        const field = document.createElement('textarea');
        field.value = text;
        field.readOnly = true;
        field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.append(field);
        field.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } finally { field.remove(); previous?.focus({ preventScroll: true }); }
        if (!copied) throw new Error('Clipboard access is unavailable.');
      };
      blocks.forEach((block) => {
        if (block.dataset.copyReady) return;
        block.dataset.copyReady = 'true';
        let shell = block;
        if (block.tagName === 'PRE') {
          shell = document.createElement('div');
          shell.className = 'code-block';
          block.before(shell);
          shell.append(block);
        }
        const toolbar = document.createElement('div');
        toolbar.className = 'code-toolbar';
        const label = document.createElement('span');
        label.className = 'code-language';
        const code = block.querySelector('.code pre, .code') || block.querySelector('code') || block;
        const languages = [...block.classList, ...(block.querySelector('code')?.classList || [])];
        label.textContent = (languages.find((value) => value.startsWith('language-'))?.replace('language-', '') || languages.find((value) => !['highlight', 'hljs'].includes(value)) || 'CODE').toUpperCase();
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy-code';
        button.textContent = '复制';
        button.setAttribute('aria-label', '复制代码');
        button.setAttribute('aria-live', 'polite');
        let feedbackTimer;
        button.addEventListener('click', async () => {
          clearTimeout(feedbackTimer);
          const clone = code.cloneNode(true);
          clone.querySelectorAll('.gutter, .code-toolbar').forEach((node) => node.remove());
          clone.querySelectorAll('br').forEach((node) => node.replaceWith(document.createTextNode('\n')));
          try {
            await writeClipboard(clone.textContent.replace(/\r\n?/g, '\n'));
            button.textContent = '已复制';
            button.dataset.state = 'success';
          } catch {
            button.textContent = '请手动复制';
            button.dataset.state = 'error';
          }
          feedbackTimer = window.setTimeout(() => { button.textContent = '复制'; delete button.dataset.state; }, 2200);
        });
        toolbar.append(label, button);
        shell.prepend(toolbar);
      });
    }

    function initImages() {
      const dialog = document.getElementById('image-dialog');
      const expanded = document.getElementById('expanded-image');
      const caption = document.getElementById('image-caption');
      if (!dialog || !expanded || !caption) return;
      const modal = setupDialog(dialog, '[data-image-close]');
      document.querySelectorAll('.post-content img').forEach((img) => {
        if (img.closest('.katex, mjx-container, [data-no-lightbox], button')) return;
        const anchor = img.closest('a');
        if (anchor && !/\.(avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(anchor.href) && anchor.href !== img.src) return;
        const trigger = anchor || img;
        trigger.classList.add('is-zoomable');
        trigger.setAttribute('aria-haspopup', 'dialog');
        if (!anchor) {
          img.tabIndex = 0;
          img.setAttribute('role', 'button');
          img.setAttribute('aria-label', `查看大图${img.alt ? `：${img.alt}` : ''}`);
        }
        const show = (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (event.type === 'click' && event.button !== 0)) return;
          const source = anchor?.href || img.getAttribute('data-original') || img.currentSrc || img.src;
          let url;
          try { url = new URL(source, document.baseURI); } catch { return; }
          if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) return;
          event.preventDefault();
          const label = img.alt || img.title || '图片预览';
          caption.textContent = label;
          expanded.alt = label;
          expanded.onload = () => { caption.textContent = label; expanded.classList.remove('is-error'); };
          expanded.onerror = () => { caption.textContent = '图片暂时无法加载，请关闭后重试。'; expanded.classList.add('is-error'); };
          expanded.classList.remove('is-error');
          expanded.src = url.href;
          modal.open(trigger);
        };
        trigger.addEventListener('click', show);
        if (!anchor) trigger.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') show(event);
        });
      });
    }

    function initScroll() {
      const header = document.getElementById('main-header');
      const tocDisclosure=document.querySelector('.post-toc details');
      if(tocDisclosure && window.matchMedia('(max-width: 639px)').matches) tocDisclosure.open=false;
      const toc = [...document.querySelectorAll('.toc-list a[href*="#"]')].map((link) => {
        let id;
        try { id = decodeURIComponent(new URL(link.href).hash.slice(1)); } catch { return null; }
        const heading = document.getElementById(id);
        return heading ? { link, heading } : null;
      }).filter(Boolean);
      let previous = Math.max(0, window.scrollY);
      let pending = false;
      let activeHeading = null;
      const update = () => {
        pending = false;
        const y = Math.max(0, window.scrollY);
        const delta = y - previous;
        document.body.classList.toggle('has-scrolled', y > 400);
        if (header) {
          if (y < 120 || delta < -5 || header.contains(document.activeElement) || document.body.classList.contains('menu-open') || document.body.classList.contains('dialog-open')) header.classList.remove('is-hidden');
          else if (delta > 5) header.classList.add('is-hidden');
        }
        if (Math.abs(delta) > 5 || y < 120) previous = y;
        if (toc.length) {
          let current = toc[0].heading;
          for (const item of toc) {
            if (item.heading.getBoundingClientRect().top <= 140) current = item.heading;
          }
          if (window.innerHeight + y >= document.documentElement.scrollHeight - 8) current = toc[toc.length - 1].heading;
          if (current !== activeHeading) {
            activeHeading = current;
            toc.forEach(({ link, heading }) => {
              const active = heading === current;
              link.classList.toggle('active', active);
              if (active) link.setAttribute('aria-current', 'location');
              else link.removeAttribute('aria-current');
            });
          }
        }
      };
      const schedule = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(update);
      };
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      window.addEventListener('hashchange', schedule);
      window.addEventListener('load', schedule, { once: true });
      document.querySelectorAll('[data-back-top]').forEach((button) => button.addEventListener('click', (event) => {
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: motion.matches ? 'auto' : 'smooth' });
      }));
      update();
    }

    function initMotion() {
      document.querySelectorAll('[data-rotating]').forEach((element) => {
        let phrases;
        try { phrases = JSON.parse(element.dataset.phrases || '[]').filter((phrase) => typeof phrase === 'string' && phrase.trim()); } catch { return; }
        if (phrases.length < 2) return;
        let index = Math.max(0, phrases.indexOf(element.textContent.trim()));
        if (!element.textContent.trim()) element.textContent = phrases[index];
        let visible = false;
        let timer;
        let swapTimer;
        const pause = () => {
          clearInterval(timer);
          clearTimeout(swapTimer);
          timer = null;
          element.classList.remove('is-changing');
        };
        const sync = () => {
          pause();
          if (!visible || document.hidden || motion.matches) return;
          timer = window.setInterval(() => {
            element.classList.add('is-changing');
            swapTimer = window.setTimeout(() => {
              index = (index + 1) % phrases.length;
              element.textContent = phrases[index];
              element.classList.remove('is-changing');
            }, 180);
          }, 3000);
        };
        if ('IntersectionObserver' in window) {
          const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
          observer.observe(element);
        } else { visible = true; sync(); }
        document.addEventListener('visibilitychange', sync);
        motionSubscribers.push(sync);
      });
      document.querySelectorAll('[data-tilt]').forEach((element) => {
        let frame = null;
        const reset = () => {
          if (frame !== null) cancelAnimationFrame(frame);
          frame = null;
          element.style.setProperty('--tilt-x', '0deg');
          element.style.setProperty('--tilt-y', '0deg');
        };
        element.addEventListener('pointermove', (event) => {
          if (motion.matches || !finePointer.matches || event.pointerType === 'touch') return;
          const bounds = element.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
          const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
          if (frame !== null) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            element.style.setProperty('--tilt-x', `${(-y * 5).toFixed(2)}deg`);
            element.style.setProperty('--tilt-y', `${(x * 5).toFixed(2)}deg`);
            frame = null;
          });
        }, { passive: true });
        element.addEventListener('pointerleave', reset);
        element.addEventListener('pointercancel', reset);
        motionSubscribers.push(reset);
        onMediaChange(finePointer, reset);
      });
    }

    function initComments() {
      const container = document.getElementById('twikoo');
      if (!container || !config.comments?.enable) return;
      const settings = config.comments;
      const status = document.getElementById('comments-status');
      const retry = document.getElementById('comments-retry');
      let loading = false;
      let loaded = false;
      const setStatus = (message, failed = false) => {
        if (status) {
          status.textContent = message;
          status.hidden = !message;
          status.setAttribute('role', 'status');
        }
        if (retry) { retry.hidden = !failed; retry.disabled = loading; }
      };
      if (!settings.envId) { setStatus('评论服务尚未配置。'); return; }
      const load = async () => {
        if (loading || loaded) return;
        loading = true;
        setStatus('正在加载评论…');
        try {
          if (!window.twikoo?.init) await loadScript(settings.script || '/js/vendor/twikoo.all.min.js');
          if (!window.twikoo?.init) throw new Error('Twikoo did not initialize.');
          const options = { envId: settings.envId, el: '#twikoo', path: settings.path || window.location.pathname, lang: 'zh-CN' };
          if (settings.region) options.region = settings.region;
          // Twikoo's form can render even when the endpoint returns an HTML error
          // page. Verify a read-only API first, so failure never looks like zero comments.
          if (window.twikoo.getCommentsCount) {
            let timer;
            try {
              const counts = await Promise.race([
                window.twikoo.getCommentsCount({envId:settings.envId,region:settings.region || undefined,urls:[options.path]}),
                new Promise((_,reject)=>{timer=window.setTimeout(()=>reject(new Error('Comment service timed out.')),12000);})
              ]);
              if (!Array.isArray(counts)) throw new Error('Invalid comment service response.');
            } finally {clearTimeout(timer);}
          }
          await window.twikoo.init(options);
          loaded = true;
          setStatus('');
        } catch (error) {
          console.warn('Comments could not load.', error);
          setStatus('评论暂时无法加载，文章仍可正常阅读。', true);
        } finally {
          loading = false;
          if (retry) retry.disabled = false;
        }
      };
      retry?.addEventListener('click', load);
      if ('IntersectionObserver' in window) {
        setStatus('滚动至此处后加载评论。');
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load(); }
        }, { rootMargin: '400px' });
        observer.observe(container.parentElement || container);
      } else load();
    }

    function initMath() {
      const article = document.querySelector('.post-content');
      if (!article || !config.math?.enable) return;
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.parentElement?.closest('pre, code, script, style, textarea, .katex, .MathJax, mjx-container, math') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });
      const rawTex = /\\\(|\\\[|\\begin\{[a-zA-Z*]+\}|\$\$[\s\S]+?\$\$|\$(?![\s$])[^$\n]+?\$/;
      let found = !!article.querySelector('script[type^="math/tex"], .eonova-math');
      while (walker.nextNode()) {
        if (rawTex.test(walker.currentNode.textContent)) { found = true; break; }
      }
      if (!found) return;
      let loading = false;
      let notice;
      const typeset = async () => {
        if (loading) return;
        loading = true;
        notice?.remove();
        try {
          if (!window.MathJax?.typesetPromise) {
            window.MathJax = {
              tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']], processEscapes: true, tags: 'ams' },
              chtml: {scale: 1.1},
              options: {
                enableMenu: false,
                skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
                ignoreHtmlClass: 'tex2jax_ignore|katex|MathJax|mjx-container|eonova-math',
                // The existing kramed renderer uses MathJax 2 script tags. Preserve
                // the original content and use the same MathJax 3 bridge as Butterfly.
                renderActions: {findScript: [10, (doc) => {
                  article.querySelectorAll('script[type^="math/tex"], .eonova-math').forEach((node) => {
                    const math = new doc.options.MathItem(node.dataset.tex || node.textContent, doc.inputJax[0], /; *mode=display/.test(node.type || ''));
                    const text = document.createTextNode('');
                    node.replaceWith(text);
                    math.start = {node: text, delim: '', n: 0};
                    math.end = {node: text, delim: '', n: 0};
                    doc.math.push(math);
                  });
                }, '']}
              },
              startup: { typeset: false }
            };
            await loadScript(config.math.script || '/js/vendor/mathjax/tex-mml-chtml.js');
          }
          if (window.MathJax?.startup?.promise) await window.MathJax.startup.promise;
          if (!window.MathJax?.typesetPromise) throw new Error('MathJax is unavailable.');
          await window.MathJax.typesetPromise([article]);
        } catch (error) {
          console.warn('Mathematical typesetting could not load.', error);
          notice = document.createElement('p');
          notice.className = 'math-status';
          notice.setAttribute('role', 'status');
          notice.textContent = '公式渲染暂时不可用，原始公式仍可阅读。';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'math-retry';
          retry.textContent = '重试';
          retry.addEventListener('click', typeset);
          notice.append(' ', retry);
          article.append(notice);
        } finally { loading = false; }
      };
      typeset();
    }

    function initCommentWidgets() {
      if (!config.comments?.enable || !config.comments?.envId) return;
      const slot = document.getElementById('recent-comments-slot');
      const counts = [...document.querySelectorAll('[data-comment-count]')];
      if (!slot && !counts.length) return;
      const options = {envId: config.comments.envId, region: config.comments.region || undefined};
      const load = async () => {
        try {
          if (!window.twikoo) await loadScript(config.comments.script);
          if (slot && config.comments.latest && window.twikoo.getRecentComments) {
            const entries = await window.twikoo.getRecentComments({...options, pageSize:config.comments.latest_count || 6, includeReply:false});
            const list = document.getElementById('recent-comments-list');
            if (Array.isArray(entries)) entries.forEach(entry => {
              if (!entry.url) return;
              const url = new URL(entry.url, location.origin);
              if (!['http:', 'https:'].includes(url.protocol)) return;
              const link = document.createElement('a');
              link.href = url.pathname + url.search + url.hash;
              const title = document.createElement('span');
              title.textContent = `${entry.nick || '访客'}：${entry.commentText || ''}`.slice(0, 95);
              const meta = document.createElement('small');
              meta.textContent = entry.title || '';
              link.append(title,meta);list.append(link);
            });
            if (list.children.length) document.getElementById('recent-comments').hidden = false;
          }
          if (counts.length && window.twikoo.getCommentsCount) {
            const entries = await window.twikoo.getCommentsCount({...options, urls:counts.map(el=>new URL(el.dataset.commentCount,location.origin).pathname)});
            if (Array.isArray(entries)) counts.forEach(el=>{
              const entry=entries.find(item=>item.url===new URL(el.dataset.commentCount,location.origin).pathname);
              if (entry && Number.isFinite(entry.count)) {el.textContent=`${entry.count} 条评论`;el.hidden=false;}
            });
          }
        } catch(error) {
          // Keep unavailable remote counters out of the page instead of inventing zeroes.
          if (slot) slot.dataset.state='unavailable';
          console.info('Comment widgets are unavailable.',error);
        }
      };
      if ('IntersectionObserver' in window) {
        const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}},{rootMargin:'100px'});
        observer.observe(slot || counts[0].closest('.post-cards'));
      } else load();
    }

    function initMermaid() {
      if (!config.mermaid?.enable) return;
      const blocks=[...document.querySelectorAll('.post-content figure.highlight.mermaid, .post-content pre code.language-mermaid, .post-content .mermaid')];
      if (!blocks.length) return;
      const diagrams=blocks.filter(el=>!blocks.some(other=>other!==el && other.contains(el))).map(el=>{
        if(el.matches('div.mermaid')) return el;
        const code=el.querySelector('.code pre') || el;
        const clone=code.cloneNode(true);clone.querySelectorAll('br').forEach(br=>br.replaceWith(document.createTextNode('\n')));
        const diagram=document.createElement('div');diagram.className='mermaid';diagram.textContent=clone.textContent;
        (el.closest('.code-block') || el).replaceWith(diagram);return diagram;
      });
      const sources=diagrams.map(el=>el.textContent);
      const render=async()=>{
        try{if(!window.mermaid)await loadScript(config.mermaid.script);window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:root.dataset.theme==='dark'?'dark':'default'});for(let i=0;i<diagrams.length;i++){diagrams[i].removeAttribute('data-processed');diagrams[i].textContent=sources[i];}await window.mermaid.run({nodes:diagrams});}
        catch(error){console.warn('Diagram rendering is unavailable.',error);}
      };
      render();window.addEventListener('eonova:themechange',render);
    }

    function initAnalytics() {
      if (!config.analytics?.busuanzi || !config.siteUrl) return;
      const productionHost=new URL(config.siteUrl).hostname.replace(/^www\./,'');
      // Public counters group visits by hostname. Localhost counters belong to
      // unrelated local previews, so never present them as this blog's traffic.
      if (location.hostname.replace(/^www\./,'') !== productionHost) return;
      loadScript('https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js').catch(()=>{});
    }

    [initTheme, initMenu, initSearch, initCode, initImages, initScroll, initMotion, initComments, initCommentWidgets, initMath, initMermaid, initAnalytics].forEach((initialize) => {
      try { initialize(); } catch (error) { console.warn(`Page enhancement ${initialize.name} could not start.`, error); }
    });
  });
})();
