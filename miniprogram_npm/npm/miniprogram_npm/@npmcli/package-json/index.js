module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046641974, function(require, module, exports) {
const fs = require('fs')
const promisify = require('util').promisify
const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const { resolve } = require('path')
const updateDeps = require('./update-dependencies.js')
const updateScripts = require('./update-scripts.js')
const updateWorkspaces = require('./update-workspaces.js')

const parseJSON = require('json-parse-even-better-errors')

const _filename = Symbol('filename')
const _manifest = Symbol('manifest')
const _readFileContent = Symbol('readFileContent')

// a list of handy specialized helper functions that take
// care of special cases that are handled by the npm cli
const knownSteps = new Set([
  updateDeps,
  updateScripts,
  updateWorkspaces,
])

// list of all keys that are handled by "knownSteps" helpers
const knownKeys = new Set([
  ...updateDeps.knownKeys,
  'scripts',
  'workspaces',
])

class PackageJson {
  static async load (path) {
    return await new PackageJson(path).load()
  }

  constructor (path) {
    this[_filename] = resolve(path, 'package.json')
    this[_manifest] = {}
    this[_readFileContent] = ''
  }

  async load () {
    try {
      this[_readFileContent] =
        await readFile(this[_filename], 'utf8')
    } catch (err) {
      throw new Error('package.json not found')
    }

    try {
      this[_manifest] =
        parseJSON(this[_readFileContent])
    } catch (err) {
      throw new Error(`Invalid package.json: ${err}`)
    }

    return this
  }

  get content () {
    return this[_manifest]
  }

  update (content) {
    // validates both current manifest and content param
    const invalidContent =
      typeof this[_manifest] !== 'object'
        || typeof content !== 'object'
    if (invalidContent) {
      throw Object.assign(
        new Error(`Can't update invalid package.json data`),
        { code: 'EPACKAGEJSONUPDATE' }
      )
    }

    for (const step of knownSteps)
      this[_manifest] = step({ content, originalContent: this[_manifest] })

    // unknown properties will just be overwitten
    for (const [key, value] of Object.entries(content)) {
      if (!knownKeys.has(key))
        this[_manifest][key] = value
    }

    return this
  }

  async save () {
    const {
      [Symbol.for('indent')]: indent,
      [Symbol.for('newline')]: newline,
    } = this[_manifest]

    const format = indent === undefined ? '  ' : indent
    const eol = newline === undefined ? '\n' : newline
    const fileContent = `${
      JSON.stringify(this[_manifest], null, format)
    }\n`
      .replace(/\n/g, eol)

    if (fileContent.trim() !== this[_readFileContent].trim())
      return await writeFile(this[_filename], fileContent)
  }
}

module.exports = PackageJson

}, function(modId) {var map = {"./update-dependencies.js":1653046641975,"./update-scripts.js":1653046641976,"./update-workspaces.js":1653046641977}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641975, function(require, module, exports) {
const depTypes = new Set([
  'dependencies',
  'optionalDependencies',
  'devDependencies',
  'peerDependencies',
])

// sort alphabetically all types of deps for a given package
const orderDeps = (content) => {
  for (const type of depTypes) {
    if (content && content[type]) {
      content[type] = Object.keys(content[type])
        .sort((a, b) => a.localeCompare(b, 'en'))
        .reduce((res, key) => {
          res[key] = content[type][key]
          return res
        }, {})
    }
  }
  return content
}

const updateDependencies = ({ content, originalContent }) => {
  const pkg = orderDeps({
    ...content,
  })

  // optionalDependencies don't need to be repeated in two places
  if (pkg.dependencies) {
    if (pkg.optionalDependencies) {
      for (const name of Object.keys(pkg.optionalDependencies))
        delete pkg.dependencies[name]
    }
  }

  const result = { ...originalContent }

  // loop through all types of dependencies and update package json pkg
  for (const type of depTypes) {
    if (pkg[type])
      result[type] = pkg[type]

    // prune empty type props from resulting object
    const emptyDepType =
      pkg[type]
      && typeof pkg === 'object'
      && Object.keys(pkg[type]).length === 0
    if (emptyDepType)
      delete result[type]
  }

  // if original package.json had dep in peerDeps AND deps, preserve that.
  const { dependencies: origProd, peerDependencies: origPeer } =
    originalContent || {}
  const { peerDependencies: newPeer } = result
  if (origProd && origPeer && newPeer) {
    // we have original prod/peer deps, and new peer deps
    // copy over any that were in both in the original
    for (const name of Object.keys(origPeer)) {
      if (origProd[name] !== undefined && newPeer[name] !== undefined) {
        result.dependencies = result.dependencies || {}
        result.dependencies[name] = newPeer[name]
      }
    }
  }

  return result
}

updateDependencies.knownKeys = depTypes

module.exports = updateDependencies

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641976, function(require, module, exports) {
const updateScripts = ({ content, originalContent = {} }) => {
  const newScripts = content.scripts

  if (!newScripts)
    return originalContent

  // validate scripts content being appended
  const hasInvalidScripts = () =>
    Object.entries(newScripts)
      .some(([key, value]) =>
        typeof key !== 'string' || typeof value !== 'string')
  if (hasInvalidScripts()) {
    throw Object.assign(
      new TypeError(
        'package.json scripts should be a key-value pair of strings.'),
      { code: 'ESCRIPTSINVALID' }
    )
  }

  return {
    ...originalContent,
    scripts: {
      ...newScripts,
    },
  }
}

module.exports = updateScripts

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641977, function(require, module, exports) {
const updateWorkspaces = ({ content, originalContent = {} }) => {
  const newWorkspaces = content.workspaces

  if (!newWorkspaces)
    return originalContent

  // validate workspaces content being appended
  const hasInvalidWorkspaces = () =>
    newWorkspaces.some(w => !(typeof w === 'string'))
  if (!newWorkspaces.length || hasInvalidWorkspaces()) {
    throw Object.assign(
      new TypeError('workspaces should be an array of strings.'),
      { code: 'EWORKSPACESINVALID' }
    )
  }

  return {
    ...originalContent,
    workspaces: [
      ...newWorkspaces,
    ],
  }
}

module.exports = updateWorkspaces

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046641974);
})()
//miniprogram-npm-outsideDeps=["fs","util","path","json-parse-even-better-errors"]
//# sourceMappingURL=index.js.map