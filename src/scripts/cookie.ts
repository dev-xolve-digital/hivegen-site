/** The value of the cookie `name` (cut to the 200 characters the server accepts), or undefined when there is none. */
export const cookie = (doc: Document, name: string): string | undefined =>
  doc.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1).slice(0, 200) || undefined;
