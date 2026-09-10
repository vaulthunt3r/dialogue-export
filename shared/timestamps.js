(function (root) {
  'use strict';

  // Accept only an actual timestamp, never a relative label or export time.
  function normalize(value) {
    let milliseconds;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
      const number = Number(value);
      milliseconds = number < 100000000000 ? number * 1000 : number;
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      const [year, month, day] = value.slice(0, 10).split('-').map(Number);
      const calendar = new Date(Date.UTC(year, month - 1, day));
      if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
      milliseconds = Date.parse(value);
    } else return null;
    // Exclude uninitialised values, corrupt seconds/milliseconds and absurd dates.
    if (!Number.isFinite(milliseconds) || milliseconds < Date.UTC(2000, 0, 1) || milliseconds >= Date.UTC(2100, 0, 1)) return null;
    return new Date(milliseconds).toISOString();
  }

  function display(value) {
    const iso = normalize(value);
    if (!iso) return '';
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    }).format(new Date(iso));
  }

  function summarize(messages) {
    return {
      available: messages.filter(message => normalize(message.createdAt)).length,
      total: messages.length,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    };
  }

  function notice(summary) {
    return `Message timestamps: ${summary.available} of ${summary.total}.${summary.available < summary.total ? ' Missing times were not provided by the page.' : ''}`;
  }

  root.ChatArchiveTimestamps = { normalize, display, summarize, notice };
})(typeof globalThis !== 'undefined' ? globalThis : window);
