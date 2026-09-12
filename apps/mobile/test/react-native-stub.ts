/**
 * A deliberate dead end.
 *
 * Nothing under test should reach React Native. If a unit test ever resolves this module, the
 * import is the bug — a pure rule has picked up a dependency on the runtime — and failing loudly
 * here is more useful than quietly pulling in a native shim and passing anyway.
 */
export const Platform = new Proxy(
  {},
  {
    get() {
      throw new Error(
        'A unit test reached React Native. Pure logic belongs in src/lib/* with no runtime imports.',
      )
    },
  },
)
