function pageTextLength(page = {}) {
  return String(page.text || '').length;
}

function normalizeExplicitFigure({ source, page, figure, index }) {
  return {
    figureId: figure.figureId || `${source.sourceId}_p${page.pageNumber}_fig${index + 1}`,
    sourceId: source.sourceId,
    pageNumber: page.pageNumber,
    label: figure.label || `Figure ${index + 1}`,
    caption: figure.caption || figure.text || '',
    bbox: figure.bbox || null,
    confidence: figure.confidence ?? 0.9,
  };
}

function inferFigureFromText({ source, page }) {
  const match = String(page.text || '').match(/\b(Figure\s+\d+)[:.\s-]+([^\n.]+\.?)/i);
  if (!match) {
    return [];
  }

  return [{
    figureId: `${source.sourceId}_p${page.pageNumber}_fig1`,
    sourceId: source.sourceId,
    pageNumber: page.pageNumber,
    label: match[1],
    caption: match[2].trim(),
    bbox: null,
    confidence: 0.64,
  }];
}

export function extractFigureCandidates({ sources = [] } = {}) {
  const pageMetadata = [];
  const figureCandidates = [];

  for (const source of sources) {
    for (const page of source.pdfPages || source.pages || []) {
      pageMetadata.push({
        sourceId: source.sourceId,
        pageNumber: page.pageNumber,
        width: page.width ?? null,
        height: page.height ?? null,
        textLength: pageTextLength(page),
      });

      const explicitFigures = Array.isArray(page.figures) ? page.figures : [];
      if (explicitFigures.length) {
        figureCandidates.push(...explicitFigures.map((figure, index) => (
          normalizeExplicitFigure({ source, page, figure, index })
        )));
        continue;
      }

      figureCandidates.push(...inferFigureFromText({ source, page }));
    }
  }

  return {
    pageMetadata,
    figureCandidates,
  };
}
