import { useNavigate, useLocation } from "react-router-dom"

/**
 * @param {number} delay
 */
function wait(delay) {
    return new Promise((resolve) => {
        setTimeout(resolve, delay)
    })
}

// function navigationDirection(param) {
//     if (typeof param === "string") {
//         return "forward-navigation"
//     } else if (typeof param === "number") {
//         return param < 0 ? "backward-navigation" : param > 0 ? "forward-navigation" : "Same_page_navigation"
//     } else {
//         return "Invalid_param"
//     }
// }

// export function useNavigateWithTransition() {
//     const navigate = useNavigate()
//     const { setIsExitComplete, updateScrollPosition } = useScrollRestorationContext()
//     const location = useLocation()
//     function transition(route, options = {}) {
//         if (document.startViewTransition && options.skipTransition) {
//             const directionForNavigation = navigationDirection(route)
//             //decide whether to use backward transition or forward transition or no transition in case route is 0
//             if (directionForNavigation === "Same_page_navigation") {
//                 navigate(route, options)
//                 return
//             }
//             //select the root element and give it the viewTransitionNameb by the directionForNavigation
//             const rootElementRef = document.querySelector(":root")
//             rootElementRef.style.viewTransitionName = directionForNavigation

//             const viewTransition = document.startViewTransition(async function updateCallback() {
//                 // Update scroll position for the current route
//                 updateScrollPosition(location.key, parseInt(window.scrollY, 10))
//                 delete options.skipTransition
//                 navigate(route, options)
//                 await wait(50)
//             })

//             // A Promise that fulfills once the pseudo-element tree is created and the transition animation is about to start.
//             viewTransition.ready.then(() => {
//                 if (directionForNavigation === "backward-navigation") {
//                     setIsExitComplete(true)
//                 } else {
//                     window.scrollTo({ top: 0, left: 0, behavior: "auto" })
//                 }
//             })

//             //A Promise that fulfills once the transition animation is finished, and the new page view is visible and interactive to the user.
//             viewTransition.finished.finally(() => {
//                 // Clear the temporary tag
//                 if (rootElementRef) rootElementRef.style.viewTransitionName = ""
//             })
//         } else {
//             // fallback for old browser
//             delete options.skipTransition
//             navigate(route, options)
//         }
//     }

//     return transition
// }

export const useNavigateWithTransition = () => {
    return useNavigate()
}
