/**
 * @type {import("react").Context<Object.<string, Promise<any>>>}
 */
export const RouteDataContext: any;
export function RouteDataProvider({ initialData, store, children }: {
    initialData?: {
        [x: string]: Promise<any>;
    };
    store?: any;
    children: any;
}): any;
export function useRouteData(routeId?: string): any;
