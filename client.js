window.__ModuleLoader__.load({
  id: '@niannya/dsh-quick-session',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const namespace = 'niannya.quickSession';
    const dictionaries = {
      en: { create: 'No project', label: 'Create a session without a project', creating: 'Creating…', failed: 'Could not create the session.', uncertain: 'If the connection was interrupted, check native session history before creating another.', close: 'Dismiss error' },
      zh: { create: '无项目', label: '新建无项目对话', creating: '正在创建…', failed: '无法创建对话。', uncertain: '连接中断时，创建可能已经完成；再次创建前请检查原生会话历史。', close: '关闭错误提示' },
    };
    const css = `
      .niannya-quick-session-button { -webkit-app-region: no-drag; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; }
      .niannya-quick-session-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .niannya-quick-session-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .niannya-quick-session-button:disabled { color: var(--dsw-alias-label-secondary); cursor: wait; }
      .niannya-quick-session-button[data-narrow] { width: 36px; height: 36px; padding: 0; }
      html[data-windows-titlebar] .niannya-quick-session-button[data-narrow] { display: none; }
      .niannya-quick-session-error { -webkit-app-region: no-drag; position: fixed; bottom: 16px; left: 16px; z-index: 1000; box-sizing: border-box; width: 340px; max-width: calc(100vw - 32px); padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; box-shadow: 0 4px 20px var(--dsw-alias-border-l1); }
      .niannya-quick-session-error-detail { margin: 8px 0 0; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
      .niannya-quick-session-close { -webkit-app-region: no-drag; float: right; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 2px 6px; font: inherit; }
    `;
    function Icon() {
      return h('svg', { width: 20, height: 20, viewBox: '0 0 36 36', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M10 7h16a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H15l-7 5v-8a5 5 0 0 1-3-5v-7a5 5 0 0 1 5-5Z', stroke: 'currentColor', strokeWidth: 2.7, strokeLinejoin: 'round' }),
        h('path', { d: 'M18 12v10M13 17h10', stroke: 'currentColor', strokeWidth: 2.7, strokeLinecap: 'round' }));
    }
    return {
      inject: ['slots', 'connection', 'locale', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => {
          const unregister = Object.entries(dictionaries).map(([locale, dictionary]) => ctx.locale.register(namespace, locale, dictionary));
          return () => { for (const dispose of unregister) dispose(); };
        }, 'quick-session: localized interface');
        const t = ctx.locale.bind(namespace);
        const subscribeLocale = ctx.locale.subscribe.bind(ctx.locale);
        const localeSnapshot = ctx.locale.getSnapshot.bind(ctx.locale);
        function QuickSessionAction({ children, wide }) {
          React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
          const [busy, setBusy] = React.useState(false);
          const [error, setError] = React.useState(null);
          const inFlight = React.useRef(false);
          const alive = React.useRef(true);
          const cancellation = React.useRef(null);
          React.useEffect(() => {
            alive.current = true;
            return () => { alive.current = false; cancellation.current?.abort(); };
          }, []);
          async function create() {
            if (inFlight.current) return;
            inFlight.current = true;
            setBusy(true); setError(null);
            const controller = new AbortController(); cancellation.current = controller;
            try {
              const requestId = globalThis.crypto.randomUUID();
              // Do not use startSession(undefined): it may choose a recent Workspace.
              // Omitted preset lets the native blank-session hero own selection.
              const result = await ctx.connection.rpc.call('/niannya-quick-session', 'create', { requestId }, controller.signal);
              if (!result.ok) throw new Error(result.error.message);
              if (!result.value || typeof result.value.sessionId !== 'string') throw new Error('Invalid session response.');
              if (alive.current) ctx.uiWorkspace.openSession(result.value.sessionId);
            } catch (cause) {
              if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              cancellation.current = null; inFlight.current = false;
              if (alive.current) setBusy(false);
            }
          }
          return h(React.Fragment, null,
            children,
            h('style', null, css),
            h('button', {
              type: 'button', className: 'niannya-quick-session-button',
              ...(wide ? {} : { 'data-narrow': '' }),
              title: t(busy ? 'creating' : 'label'), 'aria-label': t('label'), 'aria-busy': busy,
              disabled: busy, onClick: create,
            }, h(Icon), wide && h('span', null, t(busy ? 'creating' : 'create'))),
            error && h('div', { role: 'alert', className: 'niannya-quick-session-error' },
              h('button', { type: 'button', className: 'niannya-quick-session-close', 'aria-label': t('close'), onClick: () => setError(null) }, '×'),
              h('strong', null, t('failed')),
              h('p', { className: 'niannya-quick-session-error-detail' }, error),
              h('p', { className: 'niannya-quick-session-error-detail' }, t('uncertain'))));
        }
        ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
          name: 'sidebar.session.action', id: 'niannya-quick-session', order: 10,
        }, QuickSessionAction));
      },
    };
  },
});
