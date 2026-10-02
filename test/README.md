# Tests

Vitest specs for PacHuat. Run with:

```
npm test
```

(`vitest --run` — single execution, not watch mode.)

## Property-based test convention

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) under
Vitest, one test per property. Each property test MUST carry a tag comment of the
form:

```js
// Feature: pacman-hamster, Property {n}: {text}
```

and run with at least 100 iterations:

```js
fc.assert(fc.property(/* ...arbitraries... */, (/* ... */) => { /* ... */ }), {
  numRuns: 100,
});
```

Unit/example tests complement property tests by pinning specific values and edge
cases. Mock-canvas / DOM tests opt into jsdom per file via a docblock:

```js
// @vitest-environment jsdom
```
