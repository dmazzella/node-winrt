---
title: Building, testing and internals
---

# Building, testing and internals

## Scripts

```sh
npm run build         # compile TypeScript to dist/
npm run typecheck     # strict typecheck of src/, tests/ and examples/
npm run test:types    # declaration and API type tests
npm run test:unit     # cross-platform ECMA-335 .winmd & PIID unit tests
npm test              # build + type tests + unit tests + live Windows WinRT & WinUI 3 tests
npm run test:mirror   # full suite under NODE_CTYPES_NO_EXTERNAL_BUFFERS=1 (Electron / mirror mode)
npm run demo:gen:all  # regenerate WinRT projections for all 5 examples
npm run docs          # generate TypeDoc HTML documentation in docs/
npm run docs:serve    # generate docs and serve locally
npm pack --dry-run    # inspect npm package contents
```

## Electron and mirror mode

`@node-ctypes/winrt` works under `NODE_CTYPES_NO_EXTERNAL_BUFFERS=1` (Electron's V8 memory cage). Run `npm run test:mirror` to verify the full suite (including live WinRT async/OCR and WinUI 3 tests) with external ArrayBuffers disabled.

## CI and publishing

- The [CI workflow](../.github/workflows/ci.yml) runs `npm test` and `npm pack --dry-run` on Node.js 24 and 26 across Windows x64 (`windows-latest`) and Windows ARM64 (`windows-11-arm`).
- Pushing a `v<version>` tag matching `package.json` publishes to npm via Trusted Publishing (OIDC) once the entire matrix passes (prerelease versions containing `-` publish under the `next` dist-tag).
- The [Docs workflow](../.github/workflows/docs.yml) builds the TypeDoc site (`npm run docs`) and deploys it to GitHub Pages on release tags or manual dispatch.
