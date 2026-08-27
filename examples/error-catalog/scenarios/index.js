import { preflightScenarios } from "./preflight.js"
import { aiScenarios } from "./ai.js"

export const scenarios = [...preflightScenarios, ...aiScenarios]

export default scenarios
