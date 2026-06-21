/**
 * @description  Router Data
 * @typedef {{data: any, error: any, isFetching: boolean, isFetched:boolean, refetch?:(args:any)=>Promise<void>}} RouteData
 */
/**
 * @type {import("react").Context<Object.<string, RouteData>>}
 */
export const RouterContext: import("react").Context<{
    [x: string]: RouteData;
}>;
export function serverDataFetcher(serverFetchDataProps: ServerFetchDataProps, fetcherArgs: {
    [x: string]: any;
}): Promise<{
    [x: string]: RouteData;
}>;
export function RouterDataProvider({ children, initialState, fetcherArgs, config }: RouterDataProviderProps): React.JSX.Element;
export function useCurrentRouteData(): RouteData;
export function useRouterData(): {
    [x: string]: RouteData;
};
export type RouteData = {
    data: any;
    error: any;
    isFetching: boolean;
    isFetched: boolean;
    refetch?: (args: any) => Promise<void>;
};
export type RouterDataProviderConfig = {
    /**
     * disableCaching disable caching of fetched data - default is false
     */
    disableCaching?: boolean | undefined;
};
export type RouterFetcherProps = {
    /**
     * route object
     */
    route: any;
    /**
     * the current location object, which represents the current URL in web browsers.
     */
    location: import("react-router-dom").Location;
    /**
     * object of key/value pairs of the dynamic params from the current URL that were matched by the route path.
     */
    params: import("react-router-dom").Params;
    /**
     * search parameters via URLSearchParams interface.
     */
    searchParams: URLSearchParams;
    /**
     * function to navigate to other pages based on response.
     */
    navigate: import("react-router-dom").NavigateFunction;
};
export type ServerFetchDataProps = {
    /**
     * routes Array
     */
    routes: import("react-router-dom").RouteObject[];
    /**
     * current url
     */
    url: string;
    /**
     * Express request object
     */
    req: import("express").Request;
};
export type RouterDataProviderProps = {
    /**
     * Initial State of Data Provider - Mostly used to hydrate client with data from server
     */
    initialState: any;
    children: any;
    /**
     * anything passed in fetcherArgs is passed to all the fetcher functions
     */
    fetcherArgs: {
        [x: string]: any;
    };
    /**
     * Global router data provider config
     */
    config: RouterDataProviderConfig;
};
import React from "react";
