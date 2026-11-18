/** A mistake in a content file. The message always names the file, and the field or line when known. */
export class ContentError extends Error {
  constructor(message: string, public file: string, public field?: string, public line?: number) {
    super(message);
    this.name = 'ContentError';
  }
}
