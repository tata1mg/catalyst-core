const fs = require("fs")
const path = require("path")
const pc = require("picocolors")

// Function to create component using given input
function createNewComponent({ componentName, containersDir }) {
    const componentPath = path.join(containersDir, `${componentName}/${componentName}.js`)

    // Component template
    const componentTemplate = `import React from 'react';
  
  const ${componentName} = () => {
    return (
      <div>
        <h1>${componentName}</h1>
        <p>This is the ${componentName} component.</p>
      </div>
    );
  };
  
  export default ${componentName};
  `

    fs.writeFileSync(componentPath, componentTemplate, "utf8")
    console.log(`\n${pc.cyan(componentName)} component created at ${pc.gray(componentPath)}`)
}

// Function to create rtk reducer file using given input
function createRTKReducerFile({ componentName, containersDir, reducerName }) {
    const reducerPath = path.join(containersDir, `${componentName}/reducer.js`)

    // rtk reducer template
    const reducerTemplate = `import { createSlice } from "@reduxjs/toolkit"

const initialState = {
    testActionDispatched: false,
}

export const appSlice = createSlice({
    name: ${reducerName}Reducer,
    initialState: initialState,
    reducers: {
        reduxTest: (state) => {
            state.testActionDispatched = true
        },
    },
})

export const { reduxTest } = appSlice.actions
export const ${reducerName}Reducer = appSlice.reducer
`

    fs.writeFileSync(reducerPath, reducerTemplate, "utf8")
    console.log(`\n${pc.cyan("reducer.js")} file created at ${pc.gray(reducerPath)} `)
}

// Function to create redux action file using given input
function createReduxActionFile({ componentName, containersDir, reducerName }) {
    const actionsPath = path.join(containersDir, `${componentName}/actions.js`)

    // redux action template
    const actionTemplate = `const createActionTypes = (prefix, actionTypeList = []) => {
    const actionTypesObject = {}
    actionTypeList.forEach((item) => {
        actionTypesObject[item] =  prefix + "/" + item
})

return actionTypesObject
}

export default createActionTypes

export const ${reducerName}Actions = createActionTypes(${reducerName}Actions, ["REDUX_TEST"])
export const reduxTest = () => {
    return {
        type: ${reducerName}Actions.REDUX_TEST,
    }
}
`

    fs.writeFileSync(actionsPath, actionTemplate, "utf8")
    console.log(`\n${pc.cyan("action.js")} file created at ${pc.gray(actionsPath)} `)
}

// Function to create redux reducer file using given input
function createReduxReducerFile({ componentName, containersDir, reducerName }) {
    const reducerPath = path.join(containersDir, `${componentName}/reducer.js`)

    // redux reducer template
    const reducerTemplate = `import { ${reducerName}Actions } from "./actions"

export const defaultState = {
    testActionDispatched: false,
}

export const ${reducerName}Reducer = (state = defaultState, action) => {
    switch (action.type) {
        case ${reducerName}Actions.REDUX_TEST: {
            return {
                ...state,
                testActionDispatched: true,
            }
        }

        default:
            return state
    }
}
`

    fs.writeFileSync(reducerPath, reducerTemplate, "utf8")
    console.log(`\n${pc.cyan("reducer.js")} file created at ${pc.gray(reducerPath)} `)
}

module.exports = { createNewComponent, createRTKReducerFile, createReduxActionFile, createReduxReducerFile }
