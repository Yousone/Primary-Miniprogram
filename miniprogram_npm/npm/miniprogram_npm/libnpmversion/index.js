module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642229, function(require, module, exports) {
const readJson = require('./read-json.js')
const version = require('./version.js')

module.exports = async (newversion, opts = {}) => {
  const {
    path = process.cwd(),
    allowSameVersion = false,
    tagVersionPrefix = 'v',
    commitHooks = true,
    gitTagVersion = true,
    signGitCommit = false,
    signGitTag = false,
    force = false,
    ignoreScripts = false,
    scriptShell = undefined,
    preid = null,
    message = 'v%s',
    silent,
  } = opts

  const pkg = opts.pkg || await readJson(path + '/package.json')

  return version(newversion, {
    path,
    cwd: path,
    allowSameVersion,
    tagVersionPrefix,
    commitHooks,
    gitTagVersion,
    signGitCommit,
    signGitTag,
    force,
    ignoreScripts,
    scriptShell,
    preid,
    pkg,
    message,
    silent,
  })
}

}, function(modId) {var map = {"./read-json.js":1653046642230,"./version.js":1653046642231}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642230, function(require, module, exports) {
// can't use read-package-json-fast, because we want to ensure
// that we make as few changes as possible, even for safety issues.
const { promisify } = require('util')
const readFile = promisify(require('fs').readFile)
const parse = require('json-parse-even-better-errors')

module.exports = async path => parse(await readFile(path))

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642231, function(require, module, exports) {
// called with all the options already set to their defaults

const retrieveTag = require('./retrieve-tag.js')
const semver = require('semver')
const enforceClean = require('./enforce-clean.js')
const writeJson = require('./write-json.js')
const readJson = require('./read-json.js')
const git = require('@npmcli/git')
const commit = require('./commit.js')
const tag = require('./tag.js')
const log = require('proc-log')

const runScript = require('@npmcli/run-script')

module.exports = async (newversion, opts) => {
  const {
    path,
    allowSameVersion,
    gitTagVersion,
    ignoreScripts,
    preid,
    pkg,
    silent,
  } = opts

  const { valid, clean, inc } = semver
  const current = pkg.version || '0.0.0'
  const currentClean = clean(current)

  let newV
  if (valid(newversion, { loose: true })) {
    newV = clean(newversion, { loose: true })
  } else if (newversion === 'from-git') {
    newV = await retrieveTag(opts)
  } else {
    newV = inc(currentClean, newversion, { loose: true }, preid)
  }

  if (!newV) {
    throw Object.assign(new Error('Invalid version: ' + newversion), {
      current,
      requested: newversion,
    })
  }

  if (newV === currentClean && !allowSameVersion) {
    throw Object.assign(new Error('Version not changed'), {
      current,
      requested: newversion,
      newVersion: newV,
    })
  }

  const isGitDir = newversion === 'from-git' || await git.is(opts)

  // ok!  now we know the new version, and the old version is in pkg

  // - check if git dir is clean
  // returns false if we should not keep doing git stuff
  const doGit = gitTagVersion && isGitDir && await enforceClean(opts)

  if (!ignoreScripts) {
    await runScript({
      ...opts,
      pkg,
      stdio: 'inherit',
      event: 'preversion',
      banner: !silent,
      env: {
        npm_old_version: current,
        npm_new_version: newV,
      },
    })
  }

  // - update the files
  pkg.version = newV
  delete pkg._id
  await writeJson(`${path}/package.json`, pkg)

  // try to update shrinkwrap, but ok if this fails
  const locks = [`${path}/package-lock.json`, `${path}/npm-shrinkwrap.json`]
  const haveLocks = []
  for (const lock of locks) {
    try {
      const sw = await readJson(lock)
      sw.version = newV
      if (sw.packages && sw.packages['']) {
        sw.packages[''].version = newV
      }
      await writeJson(lock, sw)
      haveLocks.push(lock)
    } catch (er) {}
  }

  if (!ignoreScripts) {
    await runScript({
      ...opts,
      pkg,
      stdio: 'inherit',
      event: 'version',
      banner: !silent,
      env: {
        npm_old_version: current,
        npm_new_version: newV,
      },
    })
  }

  if (doGit) {
    // - git add, git commit, git tag
    await git.spawn(['add', `${path}/package.json`], opts)
    // sometimes people .gitignore their lockfiles
    for (const lock of haveLocks) {
      await git.spawn(['add', lock], opts).catch(() => {})
    }
    await commit(newV, opts)
    await tag(newV, opts)
  } else {
    log.verbose('version', 'Not tagging: not in a git repo or no git cmd')
  }

  if (!ignoreScripts) {
    await runScript({
      ...opts,
      pkg,
      stdio: 'inherit',
      event: 'postversion',
      banner: !silent,
      env: {
        npm_old_version: current,
        npm_new_version: newV,
      },
    })
  }

  return newV
}

}, function(modId) { var map = {"./retrieve-tag.js":1653046642232,"./enforce-clean.js":1653046642233,"./write-json.js":1653046642234,"./read-json.js":1653046642230,"./commit.js":1653046642235,"./tag.js":1653046642236}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642232, function(require, module, exports) {
const { spawn } = require('@npmcli/git')
const semver = require('semver')

module.exports = async opts => {
  const tag = (await spawn(
    ['describe', '--tags', '--abbrev=0', '--match=*.*.*'],
    opts)).stdout.trim()
  const ver = semver.coerce(tag, { loose: true })
  if (ver) {
    return ver.version
  }
  throw new Error(`Tag is not a valid version: ${JSON.stringify(tag)}`)
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642233, function(require, module, exports) {
const git = require('@npmcli/git')
const log = require('proc-log')

// returns true if it's cool to do git stuff
// throws if it's unclean, and not forced.
module.exports = async opts => {
  const { force } = opts
  let hadError = false
  const clean = await git.isClean(opts).catch(er => {
    if (er.code === 'ENOGIT') {
      log.warn(
        'version',
        'This is a Git checkout, but the git command was not found.',
        'npm could not create a Git tag for this release!'
      )
      hadError = true
      // how can merges be real if our git isn't real?
      return true
    } else {
      throw er
    }
  })

  if (!clean) {
    if (!force) {
      throw new Error('Git working directory not clean.')
    }
    log.warn('version', 'Git working directory not clean, proceeding forcefully.')
  }

  return !hadError
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642234, function(require, module, exports) {
// write the json back, preserving the line breaks and indent
const { promisify } = require('util')
const writeFile = promisify(require('fs').writeFile)
const kIndent = Symbol.for('indent')
const kNewline = Symbol.for('newline')

module.exports = async (path, pkg) => {
  const {
    [kIndent]: indent = 2,
    [kNewline]: newline = '\n',
  } = pkg
  delete pkg._id
  const raw = JSON.stringify(pkg, null, indent) + '\n'
  const data = newline === '\n' ? raw : raw.split('\n').join(newline)
  return writeFile(path, data)
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642235, function(require, module, exports) {
const git = require('@npmcli/git')

module.exports = (version, opts) => {
  const { commitHooks, allowSameVersion, signGitCommit, message } = opts
  const args = ['commit']
  if (commitHooks === false) {
    args.push('-n')
  }
  if (allowSameVersion) {
    args.push('--allow-empty')
  }
  if (signGitCommit) {
    args.push('-S')
  }
  args.push('-m')
  return git.spawn([...args, message.replace(/%s/g, version)], opts)
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642236, function(require, module, exports) {
const git = require('@npmcli/git')

module.exports = async (version, opts) => {
  const {
    signGitTag,
    allowSameVersion,
    tagVersionPrefix,
    message,
  } = opts

  const tag = `${tagVersionPrefix}${version}`
  const flags = ['-']

  if (signGitTag) {
    flags.push('s')
  }

  if (allowSameVersion) {
    flags.push('f')
  }

  flags.push('m')

  return git.spawn([
    'tag',
    flags.join(''),
    message.replace(/%s/g, version),
    tag,
  ], opts)
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642229);
})()
//miniprogram-npm-outsideDeps=["util","fs","json-parse-even-better-errors","semver","@npmcli/git","proc-log","@npmcli/run-script"]
//# sourceMappingURL=index.js.map