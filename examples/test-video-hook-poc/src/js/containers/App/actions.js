const createActionTypes = (prefix, actionTypeList = []) => {
    const actionTypesObject = {}
    actionTypeList.forEach((item) => {
        actionTypesObject[item] = `${prefix}/${item}`
    })

    return actionTypesObject
}

export default createActionTypes

export const ShellActions = createActionTypes("shellActions", ["REDUX_TEST"])
export const reduxTest = () => {
    return {
        type: ShellActions.REDUX_TEST,
    }
}
