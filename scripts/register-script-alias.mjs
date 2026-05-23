import Module from 'node:module'

const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function patchedResolveFilename(
  request,
  parent,
  isMain,
  options
) {
  if (request.startsWith('@/')) {
    const rewritten = new URL(`../.tmp-scripts/src/${request.slice(2)}.js`, import.meta.url)
    return originalResolveFilename.call(
      this,
      rewritten.pathname,
      parent,
      isMain,
      options
    )
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}
