function makeAnnotationId() {
  return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class AnnotationStore {
  constructor() {
    this.annotations = [];
  }

  add({ taskId, target, author, body, severity = 'info' }) {
    const annotation = {
      annotationId: makeAnnotationId(),
      taskId,
      target,
      author,
      body,
      severity,
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    this.annotations.push(annotation);
    return annotation;
  }

  forTask(taskId) {
    return this.annotations.filter((annotation) => annotation.taskId === taskId);
  }
}
