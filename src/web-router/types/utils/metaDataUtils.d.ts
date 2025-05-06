/**
 * Merges multiple lists of head elements, ensuring that later lists override earlier ones in case of duplicates.
 * Handles all types of head elements, including title, meta, link, etc.
 *
 * @param {...Array<JSX.Element>} lists - Multiple lists of JSX head elements, where the first argument is the parent and the rest are children in order.
 * @returns {Array<JSX.Element>} - The combined list with later lists overriding duplicates from earlier ones.
 */
export function mergeHeadElements(...lists: Array<JSX.Element>[]): Array<JSX.Element>;
/**
 * Deletes all elements in the head with a specific data attribute.
 *
 * @param {string} attributeName - The name of the data attribute to search for.
 * @param {string} [attributeValue] - The specific value of the data attribute to match (optional).
 */
export function deleteHeadTagsByDataAttribute(attributeName: string, attributeValue?: string): void;
/**
 * Returns resolved array of meta data elements.
 *
 *
 * @param {Array<Match>} matchedRoutes  - Array of all matches.
 * @param {Object} routeData  - Data returned from Router.
 * @returns {Array<JSX.Element>} - List of all meta tags for the matched location.
 */
export function getMetaData(matchedRoutes: Array<Match>, routeData: Object): Array<JSX.Element>;
