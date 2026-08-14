// Throws an ordinary Error with a nested cause so mount diagnostics prove that
// loader wrappers do not hide the actionable import/plugin failure.
export const name = 'caused'
export function apply() {
  throw new Error('outer-loader-failure', { cause: new Error('inner-loader-failure') })
}
