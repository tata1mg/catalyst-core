import { ShellActions } from "./actions"

export const defaultState = {
    testActionDispatched: false,
}

export const shellReducer = (state = defaultState, action) => {
    switch (action.type) {
        case ShellActions.REDUX_TEST: {
            return {
                ...state,
                testActionDispatched: true,
            }
        }

        default:
            return state
    }
}
