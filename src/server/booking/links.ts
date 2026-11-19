/** The site address without its closing slash, ready to have a path added. */
export const siteBase = (siteUrl: string) => siteUrl.replace(/\/$/, '');

/** The private link to a booking's manage page. The booking service and the emails both use it, so the two always agree. */
export const manageUrl = (siteUrl: string, token: string) => `${siteBase(siteUrl)}/booking/${token}`;
