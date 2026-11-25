(function () {
  if (globalThis.ChatArchiveComponents) return;
  // A static interpreter for the layout notation stored in conversation text.
  // It never compiles/evaluates JavaScript, calls page functions or mounts UI.
  const names = new Set(['card', 'box', 'row', 'column', 'grid', 'text', 'caption', 'badge', 'divider', 'spacer', 'button', 'icon', 'AsyncImage', 'Entity', 'Cite', 'svg']);
  const svgNames = 'svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask title desc marker use'.split(' ');
  const svgName = name => svgNames.find(item => item.toLowerCase() === name.toLowerCase());
  const canonical = name => name.toLowerCase() === 'cite' ? name === 'Cite' ? 'Cite' : null : [...names].find(item => item.toLowerCase() === name.toLowerCase());
  const inline = new Set(['text', 'badge', 'button', 'icon', 'Entity', 'Cite']);
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  class Unsupported extends Error {
    constructor() { super('This card contains an unsupported layout, expression or reference. No file was saved.'); this.componentUnsupported = true; }
  }
  const fail = () => { throw new Unsupported(); };
  const own = (object, key) => object != null && !forbidden.has(String(key)) && Object.hasOwn(object, key);
  function budget(state) { if (--state.steps < 0) throw new Error('This card exceeds the static rendering limit. No file was saved.'); }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const scalar = value => { if (value === null) return ''; if (!['string', 'number', 'boolean'].includes(typeof value) || /[\u0001\u0002]/.test(String(value))) fail(); return String(value); };

  // Balanced strings/braces also let us discard event handlers without parsing
  // or running their bodies (for example onClick={()=>GenUI.copy(item.c)}).
  function quotedEnd(source, start, depth = 0) {
    if (depth > 64) fail();
    const quote = source[start];
    for (let i = start + 1; i < source.length; i++) {
      if (source[i] === '\\') { i++; continue; }
      if (quote === '`' && source.slice(i, i + 2) === '${') { i = balancedEnd(source, i + 1, depth + 1) - 1; continue; }
      if (source[i] === quote) return i + 1;
    }
    fail();
  }
  function balancedEnd(source, start, depth = 0) {
    if (depth > 64) fail();
    const stack = [], pairs = { '{': '}', '[': ']', '(': ')' };
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if ('\'"`'.includes(char)) { i = quotedEnd(source, i, depth + 1) - 1; continue; }
      if (pairs[char]) { stack.push(pairs[char]); if (stack.length > 64) fail(); }
      else if ('}])'.includes(char)) {
        if (stack.pop() !== char) fail();
        if (!stack.length) return i + 1;
      }
    }
    fail();
  }
  function stringValue(source) {
    let result = '';
    for (let i = 1; i < source.length - 1; i++) {
      if (source[i] !== '\\') { result += source[i]; continue; }
      const char = source[++i], escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', '"': '"', "'": "'", '`': '`', '$': '$', '/': '/' };
      if (char === 'u' && /^[0-9a-f]{4}$/i.test(source.slice(i + 1, i + 5))) { result += String.fromCharCode(parseInt(source.slice(i + 1, i + 5), 16)); i += 4; }
      else if (Object.hasOwn(escapes, char)) result += escapes[char];
      else fail();
    }
    return result;
  }
  const precedence = { '??': 1, '||': 1, '&&': 2, '===': 3, '!==': 3, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  function expression(source, depth = 0) {
    if (depth > 64 || source.length > 262144) fail();
    let pos = 0, nesting = 0, tokens = 0;
    const space = () => { while (/\s/.test(source[pos] || '') && pos < source.length) pos++; };
    const take = value => { space(); if (source.startsWith(value, pos)) { pos += value.length; return true; } return false; };
    const expect = value => { if (!take(value)) fail(); };
    function primary() {
      space(); if (++nesting > 64 || ++tokens > 4096) fail();
      let value, match;
      const char = source[pos];
      if (char === '"' || char === "'") { const end = quotedEnd(source, pos); value = { type: 'literal', value: stringValue(source.slice(pos, end)) }; pos = end; }
      else if (char === '`') {
        const end = quotedEnd(source, pos), pieces = []; let from = ++pos;
        while (pos < end - 1) {
          if (source[pos] === '\\') { pos += 2; continue; }
          if (source.slice(pos, pos + 2) === '${') {
            pieces.push({ type: 'literal', value: stringValue('`' + source.slice(from, pos) + '`') });
            const close = balancedEnd(source, pos + 1);
            pieces.push(expression(source.slice(pos + 2, close - 1), depth + 1)); pos = close; from = pos;
          } else pos++;
        }
        pieces.push({ type: 'literal', value: stringValue('`' + source.slice(from, end - 1) + '`') }); pos = end; value = { type: 'template', pieces };
      } else if (take('(')) { value = binary(0); expect(')'); }
      else if (take('[')) {
        const items = []; if (!take(']')) for (;;) { items.push(binary(0)); if (items.length > 512) fail(); if (take(']')) break; expect(','); if (take(']')) break; }
        value = { type: 'array', items };
      } else if (take('{')) {
        const items = []; if (!take('}')) for (;;) {
          space(); let key;
          if (source[pos] === '"' || source[pos] === "'") { const end = quotedEnd(source, pos); key = stringValue(source.slice(pos, end)); pos = end; }
          else { match = source.slice(pos).match(/^[A-Za-z_$][\w$]*/); if (!match) fail(); key = match[0]; pos += key.length; }
          if (forbidden.has(key) || items.some(item => item[0] === key)) fail();
          expect(':'); items.push([key, binary(0)]); if (items.length > 128) fail(); if (take('}')) break; expect(','); if (take('}')) break;
        }
        value = { type: 'object', items };
      } else if ((match = source.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/))) {
        pos += match[0].length; const number = Number(match[0]); if (!Number.isFinite(number)) fail(); value = { type: 'literal', value: number };
      } else if ((match = source.slice(pos).match(/^[A-Za-z_$][\w$]*/))) {
        pos += match[0].length; const name = match[0];
        value = ['true', 'false', 'null'].includes(name) ? { type: 'literal', value: name === 'null' ? null : name === 'true' } : { type: 'name', name };
      } else if (char === '!' || char === '-' || char === '+') { pos++; value = { type: 'unary', operator: char, value: primary() }; }
      else fail();
      for (;;) {
        if (take('.')) { space(); match = source.slice(pos).match(/^[A-Za-z_$][\w$]*/); if (!match || forbidden.has(match[0])) fail(); pos += match[0].length; value = { type: 'member', object: value, key: { type: 'literal', value: match[0] } }; }
        else if (take('[')) { const key = binary(0); expect(']'); value = { type: 'member', object: value, key }; }
        else break;
      }
      nesting--; return value;
    }
    function binary(minimum) {
      let left = primary();
      for (;;) {
        space(); const operator = source.slice(pos).match(/^(===|!==|==|!=|<=|>=|&&|\|\||\?\?|[+\-*/%<>])/ )?.[0];
        if (!operator || precedence[operator] < minimum) break;
        pos += operator.length; left = { type: 'binary', operator, left, right: binary(precedence[operator] + 1) };
      }
      if (minimum === 0 && take('?')) { const yes = binary(0); expect(':'); left = { type: 'conditional', condition: left, yes, no: binary(0) }; }
      return left;
    }
    const result = binary(0); space(); if (pos !== source.length) fail(); return result;
  }
  function evaluate(ast, scope, state, depth = 0) {
    if (depth > 64) fail();
    budget(state);
    const run = node => evaluate(node, scope, state, depth + 1);
    if (ast.type === 'literal') return ast.value;
    if (ast.type === 'name') { if (!own(scope, ast.name)) fail(); return scope[ast.name]; }
    if (ast.type === 'array') return ast.items.map(run);
    if (ast.type === 'object') return Object.assign(Object.create(null), Object.fromEntries(ast.items.map(([key, value]) => [key, run(value)])));
    if (ast.type === 'template') return ast.pieces.map(piece => scalar(run(piece))).join('');
    if (ast.type === 'member') { const object = run(ast.object), key = run(ast.key); if (!['string', 'number'].includes(typeof key) || !own(object, key)) fail(); return object[key]; }
    if (ast.type === 'conditional') return run(ast.condition) ? run(ast.yes) : run(ast.no);
    if (ast.type === 'unary') { const value = run(ast.value); if (ast.operator === '!') return !value; if (typeof value !== 'number') fail(); return ast.operator === '-' ? -value : value; }
    if (ast.type === 'binary') {
      const a = run(ast.left), op = ast.operator;
      if (op === '&&') return a && run(ast.right); if (op === '||') return a || run(ast.right); if (op === '??') return a ?? run(ast.right);
      const b = run(ast.right);
      if (op === '===' || op === '==') return a === b; if (op === '!==' || op === '!=') return a !== b;
      if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return scalar(a) + scalar(b);
      if (typeof a !== 'number' || typeof b !== 'number') fail();
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : op === '%' ? a % b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
      if (typeof result === 'number' && !Number.isFinite(result)) fail(); return result;
    }
    fail();
  }

  function starts(source, pos = 0) { const match = source.slice(pos).match(/^<([A-Za-z][\w]*)(?=[\s/>])/); return !!match && !!canonical(match[1]); }
  function read(source, start = 0) {
    let pos = start, count = 0;
    function sequence(closing, depth, inSvg = false) {
      if (depth > 48) fail(); const nodes = []; let text = '';
      const flush = () => { if (text) { nodes.push({ type: 'text', value: text }); text = ''; } };
      while (pos < source.length) {
        if (++count > 200000) fail();
        if (closing && source.startsWith(closing, pos)) { flush(); pos += closing.length; return nodes; }
        // Literal Markdown code, including component examples, stays inert.
        if (source[pos] === '`' || source.startsWith('~~~', pos)) {
          const mark = source.slice(pos).match(/^(`+|~{3,})/)[0], end = source.indexOf(mark, pos + mark.length);
          if (end >= 0) { text += source.slice(pos, end + mark.length); pos = end + mark.length; continue; }
        }
        if (source[pos] === '\\' && pos + 1 < source.length) { text += source.slice(pos, pos + 2); pos += 2; continue; }
        if (source.startsWith('{#each ', pos)) {
          flush(); const end = balancedEnd(source, pos), header = source.slice(pos + 7, end - 1).match(/^([\s\S]+)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*$/);
          if (!header || forbidden.has(header[2]) || forbidden.has(header[3])) fail(); pos = end;
          nodes.push({ type: 'each', value: expression(header[1]), name: header[2], index: header[3], children: sequence('{/each}', depth + 1, inSvg) }); continue;
        }
        if (source.startsWith('{#if ', pos)) {
          flush(); const end = balancedEnd(source, pos), value = expression(source.slice(pos + 5, end - 1)); pos = end;
          nodes.push({ type: 'if', value, children: sequence('{/if}', depth + 1, inSvg) }); continue;
        }
        if (source[pos] === '{') { flush(); const end = balancedEnd(source, pos); nodes.push({ type: 'expression', value: expression(source.slice(pos + 1, end - 1)) }); pos = end; continue; }
        if (source[pos] === '<' && /^<\/?[A-Za-z]/.test(source.slice(pos))) {
          if (!inSvg && !starts(source, pos)) fail(); flush(); nodes.push(component(depth + 1, inSvg)); continue;
        }
        text += source[pos++];
      }
      if (closing) fail(); flush(); return nodes;
    }
    function component(depth, inSvg = false) {
      if (depth > 48) fail(); const match = source.slice(pos).match(/^<([A-Za-z][\w]*)/);
      const name = match && (inSvg ? svgName(match[1]) : canonical(match[1])); if (!name) fail();
      const sourceName = match[1], attrs = Object.create(null); pos += match[0].length;
      for (;;) {
        while (/\s/.test(source[pos] || '') && pos < source.length) pos++;
        if (source.startsWith('/>', pos)) { pos += 2; return { type: 'component', name, attrs, children: [] }; }
        if (source[pos] === '>') { pos++; break; }
        const attr = source.slice(pos).match(/^([A-Za-z_][\w-]*)/); if (!attr) fail(); pos += attr[0].length;
        while (/\s/.test(source[pos] || '') && pos < source.length) pos++;
        let value = { type: 'literal', value: true };
        if (source[pos] === '=') {
          pos++; while (/\s/.test(source[pos] || '') && pos < source.length) pos++;
          if (source[pos] === '{') { const end = balancedEnd(source, pos); if (!/^on/i.test(attr[1])) value = expression(source.slice(pos + 1, end - 1)); pos = end; }
          else if (source[pos] === '"' || source[pos] === "'") { const end = quotedEnd(source, pos); value = { type: 'literal', value: stringValue(source.slice(pos, end)) }; pos = end; }
          else fail();
        }
        if (forbidden.has(attr[1]) || Object.hasOwn(attrs, attr[1])) fail(); if (!/^on/i.test(attr[1])) attrs[attr[1]] = value;
      }
      return { type: 'component', name, attrs, children: sequence(`</${sourceName}>`, depth + 1, inSvg || name === 'svg') };
    }
    const node = component(0); return { node, end: pos };
  }

  // Serialize only passive SVG shapes. Expressions use the same bounded data
  // interpreter as cards; no SVG source, script or event handler is executed.
  const svgAttributes = 'id viewBox width height x y dx dy x1 x2 y1 y2 cx cy r rx ry d points transform preserveAspectRatio fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color font-family font-size font-weight font-style text-anchor dominant-baseline clip-path clip-rule mask marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits gradientUnits gradientTransform offset stop-color stop-opacity href xmlns'.split(' ');
  const svgStyleProperties = new Set('fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color font-family font-size font-weight font-style text-anchor dominant-baseline'.split(' '));
  function svgAttribute(name) {
    const dashed = name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    return svgAttributes.find(item => item.toLowerCase() === name.toLowerCase() || item === dashed);
  }
  function svgEntities(value) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    return value.replace(/&(amp|lt|gt|quot|apos|nbsp|#x[0-9a-f]{1,6}|#\d{1,7});/gi, (token, name) => {
      if (Object.hasOwn(entities, name)) return entities[name];
      const number = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : name.startsWith('#') ? Number(name.slice(1)) : NaN;
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : token;
    });
  }
  function svgValue(name, value) {
    let text = svgEntities(scalar(value));
    if (/[<>\\\u0000-\u001f]/.test(text) || /(?:javascript:|data:|expression\s*\(|@import)/i.test(text)) fail();
    if (name === 'xmlns') { if (text !== 'http://www.w3.org/2000/svg') fail(); return text; }
    if (name === 'href' && !/^#[\w.-]+$/.test(text)) fail();
    if (/url\s*\(/i.test(text)) {
      const local = text.match(/^url\(\s*['"]?(#[\w.-]+)['"]?\s*\)$/i); if (!local) fail();
      text = `url(${local[1]})`;
    }
    if (/^(?:https?:|file:|\/\/)/i.test(text)) fail();
    return text.replace(/\bcurrentColor\b/gi, '#1d2026');
  }
  function svgSource(root, scope, state) {
    let characters = 0;
    const write = value => {
      characters += value.length;
      if (characters > 1024 * 1024) throw new Error('This diagram exceeds the static rendering limit. No file was saved.');
      return value;
    };
    const children = (nodes, local) => nodes.map(node => visit(node, local)).join('');
    function visit(node, local) {
      budget(state); if (++state.nodes > 10000) throw new Error('This diagram exceeds the static rendering limit. No file was saved.');
      if (node.type === 'text') return write(escape(svgEntities(node.value)));
      if (node.type === 'expression') return write(escape(scalar(evaluate(node.value, local, state))));
      if (node.type === 'if') return evaluate(node.value, local, state) ? children(node.children, local) : '';
      if (node.type === 'each') {
        const values = evaluate(node.value, local, state); if (!Array.isArray(values) || values.length > 512) fail();
        return values.map((value, index) => children(node.children, Object.assign(Object.create(null), local, { [node.name]: value }, node.index ? { [node.index]: index } : {}))).join('');
      }
      if (!svgNames.includes(node.name)) fail();
      const attrs = Object.create(null), overrides = Object.create(null);
      for (const [key, ast] of Object.entries(node.attrs)) {
        const value = evaluate(ast, local, state);
        if (key === 'style') {
          const styles = typeof value === 'string' ? value.split(';').filter(part => part.trim()).map(part => {
            const colon = part.indexOf(':'); if (colon < 0) fail(); return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
          }) : value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : null;
          if (!styles) fail();
          for (const [property, item] of styles) {
            const attribute = svgAttribute(property); if (!svgStyleProperties.has(attribute)) fail();
            overrides[attribute] = svgValue(attribute, item);
          }
          continue;
        }
        const attribute = svgAttribute(key); if (!attribute) fail();
        attrs[attribute] = svgValue(attribute, value);
      }
      Object.assign(attrs, overrides);
      if (node === root) {
        const box = (attrs.viewBox || '').trim().split(/[\s,]+/).map(Number);
        const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
        for (const [name, index] of [['width', 2], ['height', 3]]) {
          const value = attrs[name], dimension = /^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(value || '') ? parseFloat(value) : hasBox ? box[index] : 0;
          if (!(dimension > 0 && Number.isFinite(dimension))) fail();
          attrs[name] = String(dimension);
        }
        attrs.xmlns = 'http://www.w3.org/2000/svg';
        attrs.fill ||= '#1d2026'; attrs['font-family'] ||= 'sans-serif';
      }
      const attributes = Object.entries(attrs).map(([name, value]) => ` ${name}="${escape(value)}"`).join('');
      return write(`<${node.name}${attributes}>`) + children(node.children, local) + write(`</${node.name}>`);
    }
    return visit(root, scope);
  }

  const palette = { 'surface': '#ffffff', 'surface-elevated': '#ffffff', 'surface-secondary': '#f3f4f6', 'surface-tertiary': '#e5e7eb', 'primary': '#1d2026', 'secondary': '#596273', 'tertiary': '#6b7280', 'subtle': '#d1d5db', 'success': '#166534', 'warning': '#92400e', 'danger': '#b91c1c', 'info': '#1d4ed8', 'transparent': 'transparent' };
  function color(value) { const text = String(value); if (Object.hasOwn(palette, text)) return palette[text]; if (/^#[0-9a-f]{3,8}$/i.test(text) && [4,5,7,9].includes(text.length)) return text; if (/^(?:black|white|red|green|blue|gray|grey|orange|purple)$/i.test(text)) return text; fail(); }
  function length(value) { if (typeof value === 'number' && value >= 0 && value <= 4096) return `${value}px`; if (typeof value === 'string' && /^(?:\d+(?:\.\d+)?)(?:px|%|rem|em)$/.test(value) && parseFloat(value) <= 4096) return value; fail(); }
  function styles(name, attrs) {
    const values = ['min-width:0', 'max-width:100%', 'box-sizing:border-box'];
    const set = (property, value) => values.push(`${property}:${value}`);
    if (['card', 'box', 'row', 'column'].includes(name)) { set('display', 'flex'); set('flex-direction', name === 'row' ? 'row' : 'column'); set('gap', name === 'row' ? '8px' : '0'); }
    if (name === 'card') { set('padding', '16px'); set('border', '1px solid #d1d5db'); set('border-radius', '12px'); set('background-color', '#ffffff'); set('margin', '12px 0'); }
    if (name === 'grid') { set('display', 'grid'); const columns = attrs.columns ?? 2; if (!Number.isInteger(columns) || columns < 1 || columns > 12) fail(); set('grid-template-columns', `repeat(${columns},minmax(0,1fr))`); set('gap', '12px'); }
    if (name === 'spacer') set('flex', '1 1 0%');
    if (name === 'caption') { set('font-size', '13px'); set('color', '#596273'); }
    if (name === 'badge') { set('display', 'inline-block'); set('padding', '2px 7px'); set('border', '1px solid currentColor'); set('border-radius', '5px'); set('font-size', '12px'); }
    if (name === 'divider') { set('border', '0'); set('border-top', `1px solid ${color(attrs.color || 'subtle')}`); set('width', '100%'); set('margin', '8px 0'); }
    for (const [key, value] of Object.entries(attrs)) {
      if (['gap', 'padding', 'paddingX', 'paddingY'].includes(key)) {
        if (typeof value !== 'number' || value < 0 || value > 64) fail();
        set(({ paddingX: 'padding-inline', paddingY: 'padding-block' })[key] || key, `${value * 4}px`);
      } else if (['width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight'].includes(key)) set(key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), length(value));
      else if (key === 'background' || key === 'color') set(key === 'background' ? 'background-color' : 'color', color(value));
      else if (key === 'radius') { const radius = { none: '0', sm: '4px', md: '8px', lg: '12px', xl: '16px', full: '999px' }; set('border-radius', Object.hasOwn(radius, value) ? radius[value] : length(value)); }
      else if (key === 'flex') { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 100) fail(); set('flex', `${number} 1 0%`); }
      else if (key === 'align' || key === 'justify') { const choices = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch', between: 'space-between', around: 'space-around' }; if (!own(choices, value)) fail(); set(key === 'align' ? 'align-items' : 'justify-content', choices[value]); }
      else if (key === 'weight') { const choices = { normal: 400, medium: 500, semibold: 600, bold: 700 }; if (!own(choices, value)) fail(); set('font-weight', choices[value]); }
      else if (key === 'textAlign') { if (!['start', 'end', 'left', 'right', 'center'].includes(value)) fail(); set('text-align', value); }
      else if (key === 'direction') { if (!['row', 'col', 'column'].includes(value)) fail(); set('flex-direction', value === 'row' ? 'row' : 'column'); }
    }
    return values.join(';');
  }
  function render(node, context, scope = Object.create(null), state = { steps: 50000, nodes: 0 }) {
    budget(state); if (++state.nodes > 10000) throw new Error('This card exceeds the static rendering limit. No file was saved.');
    const evaluateHere = value => evaluate(value, scope, state);
    if (node.type === 'expression') return { html: escape(scalar(evaluateHere(node.value))), inline: true };
    if (node.type === 'each') {
      const values = evaluateHere(node.value); if (!Array.isArray(values) || values.length > 512) fail();
      return { html: values.map((value, index) => context.sequence(node.children, Object.assign(Object.create(null), scope, { [node.name]: value }, node.index ? { [node.index]: index } : {}), state)).join(''), inline: false };
    }
    if (node.type === 'if') return { html: evaluateHere(node.value) ? context.sequence(node.children, scope, state) : '', inline: false };
    if (node.name === 'svg') return { html: context.includeImages === false ? '' : context.svg(svgSource(node, scope, state)), inline: false };
    const attrs = Object.create(null); for (const [name, value] of Object.entries(node.attrs)) attrs[name] = evaluateHere(value);
    const name = node.name;
    if (name === 'icon') return { html: '', inline: true };
    if (['Cite', 'Entity', 'AsyncImage'].includes(name)) return { html: context.reference(name, attrs), inline: inline.has(name) };
    const child = context.sequence(node.children, scope, state, inline.has(name));
    const tag = name === 'divider' ? 'hr' : inline.has(name) ? 'span' : 'div';
    const html = `<${tag} class="chat-archive-component export-static-component" data-d-component="${name}" style="${escape(styles(name, attrs))}">${tag === 'hr' ? '' : `${child}</${tag}>`}`;
    return { html, inline: inline.has(name) };
  }
  window.ChatArchiveComponents = { starts, read, render, Unsupported, escape, inline };
})();
