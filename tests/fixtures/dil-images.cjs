// Synthetic saved-message shape, not a private conversation capture.
module.exports = function dilImages() {
  const queries = ['MS Paint illustration', 'Doomer drawing', 'Animated character', 'Old Flash cartoon'];
  const urls = queries.map((_, i) => `https://images.openai.com/static-rsc-4/example-${i}?purpose=inline`);
  const constants = {}, componentResults = {};
  const calls = queries.map((query, i) => {
    constants[String(2 * i)] = query;
    constants[String(2 * i + 1)] = `image-${i}`;
    return `__dil.jsx(AsyncImage,{"__resolutionId":__dilConstants["${2 * i + 1}"],"query":${i % 2 ? JSON.stringify(query) : `__dilConstants["${2 * i}"]`},"aspectRatio":"4:3"})`;
  });
  // Result insertion order deliberately differs from the card order.
  for (const i of [2, 0, 3, 1]) componentResults[`image-${i}`] = {
    componentName: 'AsyncImage', status: 'resolved', state: { is_loading: false, images: [{
      content_url: urls[i], original_content_url: `https://example.com/original-${i}.jpg`, url: `https://example.com/source-${i}`
    }] }
  };
  const bundle = {
    code: `DIL.render(__dil.jsx(() => { const __dilConstants = DIL.useConstants(); return __dil.jsx("row",null,${calls.join(',')}); }, {key:"body:0"}));`,
    constants, appData: { opGenui: { componentResults } }
  };
  const safe_urls = urls.flatMap((url, i) => [url, `https://example.com/original-${i}.jpg`, `https://example.com/source-${i}`]);
  return { queries, urls, bundle,
    source: 'Before illustrations\n\n<row>' + queries.map(query => `<box><AsyncImage query="${query}" aspectRatio="4:3"/><text>${query}</text></box>`).join('') + '</row>\n\nAfter illustrations',
    metadata: { content_references: [{ type: 'dil', matched_text: '', safe_urls, model_dil_v2: bundle }], safe_urls }
  };
};
