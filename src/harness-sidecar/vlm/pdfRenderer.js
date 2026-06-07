import { createStableArtifactId, createVisualEstimate } from './artifactManifest.js';

export function createPdfPageArtifacts({ taskId, pdfPath, document = {}, pages = [] } = {}) {
  return pages.map((page) => {
    const payload = { taskId, pdfPath, document, page };

    return {
      artifactId: createStableArtifactId('pdf_page', payload),
      taskId,
      type: 'pdf_page',
      summary: `PDF page ${page.pageNumber} artifact for ${pdfPath}`,
      artifacts: {
        image: page.imagePath,
        pdf: pdfPath,
      },
      metadata: {
        document,
        page: {
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
          textSnippet: page.textSnippet,
        },
      },
      visualContext: createVisualEstimate({ width: page.width, height: page.height }),
    };
  });
}
