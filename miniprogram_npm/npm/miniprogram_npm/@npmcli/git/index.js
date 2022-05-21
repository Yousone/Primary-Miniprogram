module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046641949, function(require, module, exports) {
module.exports = {
  clone: require('./clone.js'),
  revs: require('./revs.js'),
  spawn: require('./spawn.js'),
  is: require('./is.js'),
  find: require('./find.js'),
  isClean: require('./is-clean.js'),
  errors: require('./errors.js'),
}

}, function(modId) {var map = {"./clone.js":1653046641950,"./revs.js":1653046641951,"./spawn.js":1653046641952,"./is.js":1653046641959,"./find.js":1653046641960,"./is-clean.js":1653046641961,"./errors.js":1653046641954}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641950, function(require, module, exports) {
// The goal here is to minimize both git workload and
// the number of refs we download over the network.
//
// Every method ends up with the checked out working dir
// at the specified ref, and resolves with the git sha.

// Only certain whitelisted hosts get shallow cloning.
// Many hosts (including GHE) don't always support it.
// A failed shallow fetch takes a LOT longer than a full
// fetch in most cases, so we skip it entirely.
// Set opts.gitShallow = true/false to force this behavior
// one way or the other.
const shallowHosts = new Set([
  'github.com',
  'gist.github.com',
  'gitlab.com',
  'bitbucket.com',
  'bitbucket.org',
])
// we have to use url.parse until we add the same shim that hosted-git-info has
// to handle scp:// urls
const { parse } = require('url') // eslint-disable-line node/no-deprecated-api
const { basename, resolve } = require('path')

const revs = require('./revs.js')
const spawn = require('./spawn.js')
const { isWindows } = require('./utils.js')

const pickManifest = require('npm-pick-manifest')
const fs = require('fs')
const mkdirp = require('mkdirp')

module.exports = (repo, ref = 'HEAD', target = null, opts = {}) =>
  revs(repo, opts).then(revs => clone(
    repo,
    revs,
    ref,
    resolveRef(revs, ref, opts),
    target || defaultTarget(repo, opts.cwd),
    opts
  ))

const maybeShallow = (repo, opts) => {
  if (opts.gitShallow === false || opts.gitShallow) {
    return opts.gitShallow
  }
  return shallowHosts.has(parse(repo).host)
}

const defaultTarget = (repo, /* istanbul ignore next */ cwd = process.cwd()) =>
  resolve(cwd, basename(repo.replace(/[/\\]?\.git$/, '')))

const clone = (repo, revs, ref, revDoc, target, opts) => {
  if (!revDoc) {
    return unresolved(repo, ref, target, opts)
  }
  if (revDoc.sha === revs.refs.HEAD.sha) {
    return plain(repo, revDoc, target, opts)
  }
  if (revDoc.type === 'tag' || revDoc.type === 'branch') {
    return branch(repo, revDoc, target, opts)
  }
  return other(repo, revDoc, target, opts)
}

const resolveRef = (revs, ref, opts) => {
  const { spec = {} } = opts
  ref = spec.gitCommittish || ref
  /* istanbul ignore next - will fail anyway, can't pull */
  if (!revs) {
    return null
  }
  if (spec.gitRange) {
    return pickManifest(revs, spec.gitRange, opts)
  }
  if (!ref) {
    return revs.refs.HEAD
  }
  if (revs.refs[ref]) {
    return revs.refs[ref]
  }
  if (revs.shas[ref]) {
    return revs.refs[revs.shas[ref][0]]
  }
  return null
}

// pull request or some other kind of advertised ref
const other = (repo, revDoc, target, opts) => {
  const shallow = maybeShallow(repo, opts)

  const fetchOrigin = ['fetch', 'origin', revDoc.rawRef]
    .concat(shallow ? ['--depth=1'] : [])

  const git = (args) => spawn(args, { ...opts, cwd: target })
  return mkdirp(target)
    .then(() => git(['init']))
    .then(() => isWindows(opts)
      ? git(['config', '--local', '--add', 'core.longpaths', 'true'])
      : null)
    .then(() => git(['remote', 'add', 'origin', repo]))
    .then(() => git(fetchOrigin))
    .then(() => git(['checkout', revDoc.sha]))
    .then(() => updateSubmodules(target, opts))
    .then(() => revDoc.sha)
}

// tag or branches.  use -b
const branch = (repo, revDoc, target, opts) => {
  const args = [
    'clone',
    '-b',
    revDoc.ref,
    repo,
    target,
    '--recurse-submodules',
  ]
  if (maybeShallow(repo, opts)) {
    args.push('--depth=1')
  }
  if (isWindows(opts)) {
    args.push('--config', 'core.longpaths=true')
  }
  return spawn(args, opts).then(() => revDoc.sha)
}

// just the head.  clone it
const plain = (repo, revDoc, target, opts) => {
  const args = [
    'clone',
    repo,
    target,
    '--recurse-submodules',
  ]
  if (maybeShallow(repo, opts)) {
    args.push('--depth=1')
  }
  if (isWindows(opts)) {
    args.push('--config', 'core.longpaths=true')
  }
  return spawn(args, opts).then(() => revDoc.sha)
}

const updateSubmodules = (target, opts) => new Promise(resolve =>
  fs.stat(target + '/.gitmodules', er => {
    if (er) {
      return resolve(null)
    }
    return resolve(spawn([
      'submodule',
      'update',
      '-q',
      '--init',
      '--recursive',
    ], { ...opts, cwd: target }))
  }))

const unresolved = (repo, ref, target, opts) => {
  // can't do this one shallowly, because the ref isn't advertised
  // but we can avoid checking out the working dir twice, at least
  const lp = isWindows(opts) ? ['--config', 'core.longpaths=true'] : []
  const cloneArgs = ['clone', '--mirror', '-q', repo, target + '/.git']
  const git = (args) => spawn(args, { ...opts, cwd: target })
  return mkdirp(target)
    .then(() => git(cloneArgs.concat(lp)))
    .then(() => git(['init']))
    .then(() => git(['checkout', ref]))
    .then(() => updateSubmodules(target, opts))
    .then(() => git(['rev-parse', '--revs-only', 'HEAD']))
    .then(({ stdout }) => stdout.trim())
}

}, function(modId) { var map = {"./revs.js":1653046641951,"./spawn.js":1653046641952,"./utils.js":1653046641958}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641951, function(require, module, exports) {
const pinflight = require('promise-inflight')
const spawn = require('./spawn.js')
const LRU = require('lru-cache')

const revsCache = new LRU({
  max: 100,
  ttl: 5 * 60 * 1000,
})

const linesToRevs = require('./lines-to-revs.js')

module.exports = async (repo, opts = {}) => {
  if (!opts.noGitRevCache) {
    const cached = revsCache.get(repo)
    if (cached) {
      return cached
    }
  }

  return pinflight(`ls-remote:${repo}`, () =>
    spawn(['ls-remote', repo], opts)
      .then(({ stdout }) => linesToRevs(stdout.trim().split('\n')))
      .then(revs => {
        revsCache.set(repo, revs)
        return revs
      })
  )
}

}, function(modId) { var map = {"./spawn.js":1653046641952,"./lines-to-revs.js":1653046641957}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641952, function(require, module, exports) {
const spawn = require('@npmcli/promise-spawn')
const promiseRetry = require('promise-retry')
const log = require('proc-log')
const makeError = require('./make-error.js')
const whichGit = require('./which.js')
const makeOpts = require('./opts.js')

module.exports = (gitArgs, opts = {}) => {
  const gitPath = whichGit(opts)

  if (gitPath instanceof Error) {
    return Promise.reject(gitPath)
  }

  // undocumented option, mostly only here for tests
  const args = opts.allowReplace || gitArgs[0] === '--no-replace-objects'
    ? gitArgs
    : ['--no-replace-objects', ...gitArgs]

  let retry = opts.retry
  if (retry === null || retry === undefined) {
    retry = {
      retries: opts.fetchRetries || 2,
      factor: opts.fetchRetryFactor || 10,
      maxTimeout: opts.fetchRetryMaxtimeout || 60000,
      minTimeout: opts.fetchRetryMintimeout || 1000,
    }
  }
  return promiseRetry((retry, number) => {
    if (number !== 1) {
      log.silly('git', `Retrying git command: ${
        args.join(' ')} attempt # ${number}`)
    }

    return spawn(gitPath, args, makeOpts(opts))
      .catch(er => {
        const gitError = makeError(er)
        if (!gitError.shouldRetry(number)) {
          throw gitError
        }
        retry(gitError)
      })
  }, retry)
}

}, function(modId) { var map = {"./make-error.js":1653046641953,"./which.js":1653046641955,"./opts.js":1653046641956}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641953, function(require, module, exports) {
const {
  GitConnectionError,
  GitPathspecError,
  GitUnknownError,
} = require('./errors.js')

const connectionErrorRe = new RegExp([
  'remote error: Internal Server Error',
  'The remote end hung up unexpectedly',
  'Connection timed out',
  'Operation timed out',
  'Failed to connect to .* Timed out',
  'Connection reset by peer',
  'SSL_ERROR_SYSCALL',
  'The requested URL returned error: 503',
].join('|'))

const missingPathspecRe = /pathspec .* did not match any file\(s\) known to git/

function makeError (er) {
  const message = er.stderr
  let gitEr
  if (connectionErrorRe.test(message)) {
    gitEr = new GitConnectionError(message)
  } else if (missingPathspecRe.test(message)) {
    gitEr = new GitPathspecError(message)
  } else {
    gitEr = new GitUnknownError(message)
  }
  return Object.assign(gitEr, er)
}

module.exports = makeError

}, function(modId) { var map = {"./errors.js":1653046641954}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641954, function(require, module, exports) {

const maxRetry = 3

class GitError extends Error {
  shouldRetry () {
    return false
  }
}

class GitConnectionError extends GitError {
  constructor (message) {
    super('A git connection error occurred')
  }

  shouldRetry (number) {
    return number < maxRetry
  }
}

class GitPathspecError extends GitError {
  constructor (message) {
    super('The git reference could not be found')
  }
}

class GitUnknownError extends GitError {
  constructor (message) {
    super('An unknown git error occurred')
  }
}

module.exports = {
  GitConnectionError,
  GitPathspecError,
  GitUnknownError,
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641955, function(require, module, exports) {
const which = require('which')

let gitPath
try {
  gitPath = which.sync('git')
} catch (e) {}

module.exports = (opts = {}) => {
  if (opts.git) {
    return opts.git
  }
  if (!gitPath || opts.git === false) {
    return Object.assign(new Error('No git binary found in $PATH'), { code: 'ENOGIT' })
  }
  return gitPath
}

}, function(modId) { var map = {"which":1653046641955}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641956, function(require, module, exports) {
// Values we want to set if they're not already defined by the end user
// This defaults to accepting new ssh host key fingerprints
const gitEnv = {
  GIT_ASKPASS: 'echo',
  GIT_SSH_COMMAND: 'ssh -oStrictHostKeyChecking=accept-new',
}
module.exports = (opts = {}) => ({
  stdioString: true,
  ...opts,
  shell: false,
  env: opts.env || { ...gitEnv, ...process.env },
})

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641957, function(require, module, exports) {
// turn an array of lines from `git ls-remote` into a thing
// vaguely resembling a packument, where docs are a resolved ref

const semver = require('semver')

module.exports = lines => finish(lines.reduce(linesToRevsReducer, {
  versions: {},
  'dist-tags': {},
  refs: {},
  shas: {},
}))

const finish = revs => distTags(shaList(peelTags(revs)))

// We can check out shallow clones on specific SHAs if we have a ref
const shaList = revs => {
  Object.keys(revs.refs).forEach(ref => {
    const doc = revs.refs[ref]
    if (!revs.shas[doc.sha]) {
      revs.shas[doc.sha] = [ref]
    } else {
      revs.shas[doc.sha].push(ref)
    }
  })
  return revs
}

// Replace any tags with their ^{} counterparts, if those exist
const peelTags = revs => {
  Object.keys(revs.refs).filter(ref => ref.endsWith('^{}')).forEach(ref => {
    const peeled = revs.refs[ref]
    const unpeeled = revs.refs[ref.replace(/\^\{\}$/, '')]
    if (unpeeled) {
      unpeeled.sha = peeled.sha
      delete revs.refs[ref]
    }
  })
  return revs
}

const distTags = revs => {
  // not entirely sure what situations would result in an
  // ichabod repo, but best to be careful in Sleepy Hollow anyway
  const HEAD = revs.refs.HEAD || /* istanbul ignore next */ {}
  const versions = Object.keys(revs.versions)
  versions.forEach(v => {
    // simulate a dist-tags with latest pointing at the
    // 'latest' branch if one exists and is a version,
    // or HEAD if not.
    const ver = revs.versions[v]
    if (revs.refs.latest && ver.sha === revs.refs.latest.sha) {
      revs['dist-tags'].latest = v
    } else if (ver.sha === HEAD.sha) {
      revs['dist-tags'].HEAD = v
      if (!revs.refs.latest) {
        revs['dist-tags'].latest = v
      }
    }
  })
  return revs
}

const refType = ref => {
  if (ref.startsWith('refs/tags/')) {
    return 'tag'
  }
  if (ref.startsWith('refs/heads/')) {
    return 'branch'
  }
  if (ref.startsWith('refs/pull/')) {
    return 'pull'
  }
  if (ref === 'HEAD') {
    return 'head'
  }
  // Could be anything, ignore for now
  /* istanbul ignore next */
  return 'other'
}

// return the doc, or null if we should ignore it.
const lineToRevDoc = line => {
  const split = line.trim().split(/\s+/, 2)
  if (split.length < 2) {
    return null
  }

  const sha = split[0].trim()
  const rawRef = split[1].trim()
  const type = refType(rawRef)

  if (type === 'tag') {
    // refs/tags/foo^{} is the 'peeled tag', ie the commit
    // that is tagged by refs/tags/foo they resolve to the same
    // content, just different objects in git's data structure.
    // But, we care about the thing the tag POINTS to, not the tag
    // object itself, so we only look at the peeled tag refs, and
    // ignore the pointer.
    // For now, though, we have to save both, because some tags
    // don't have peels, if they were not annotated.
    const ref = rawRef.substr('refs/tags/'.length)
    return { sha, ref, rawRef, type }
  }

  if (type === 'branch') {
    const ref = rawRef.substr('refs/heads/'.length)
    return { sha, ref, rawRef, type }
  }

  if (type === 'pull') {
    // NB: merged pull requests installable with #pull/123/merge
    // for the merged pr, or #pull/123 for the PR head
    const ref = rawRef.substr('refs/'.length).replace(/\/head$/, '')
    return { sha, ref, rawRef, type }
  }

  if (type === 'head') {
    const ref = 'HEAD'
    return { sha, ref, rawRef, type }
  }

  // at this point, all we can do is leave the ref un-munged
  return { sha, ref: rawRef, rawRef, type }
}

const linesToRevsReducer = (revs, line) => {
  const doc = lineToRevDoc(line)

  if (!doc) {
    return revs
  }

  revs.refs[doc.ref] = doc
  revs.refs[doc.rawRef] = doc

  if (doc.type === 'tag') {
    // try to pull a semver value out of tags like `release-v1.2.3`
    // which is a pretty common pattern.
    const match = !doc.ref.endsWith('^{}') &&
      doc.ref.match(/v?(\d+\.\d+\.\d+(?:[-+].+)?)$/)
    if (match && semver.valid(match[1], true)) {
      revs.versions[semver.clean(match[1], true)] = doc
    }
  }

  return revs
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641958, function(require, module, exports) {
const isWindows = opts => (opts.fakePlatform || process.platform) === 'win32'

exports.isWindows = isWindows

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641959, function(require, module, exports) {
// not an airtight indicator, but a good gut-check to even bother trying
const { promisify } = require('util')
const fs = require('fs')
const stat = promisify(fs.stat)
module.exports = ({ cwd = process.cwd() } = {}) =>
  stat(cwd + '/.git').then(() => true, () => false)

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641960, function(require, module, exports) {
const is = require('./is.js')
const { dirname } = require('path')

module.exports = async ({ cwd = process.cwd() } = {}) => {
  if (await is({ cwd })) {
    return cwd
  }
  while (cwd !== dirname(cwd)) {
    cwd = dirname(cwd)
    if (await is({ cwd })) {
      return cwd
    }
  }
  return null
}

}, function(modId) { var map = {"./is.js":1653046641959}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641961, function(require, module, exports) {
const spawn = require('./spawn.js')

module.exports = (opts = {}) =>
  spawn(['status', '--porcelain=v1', '-uno'], opts)
    .then(res => !res.stdout.trim().split(/\r?\n+/)
      .map(l => l.trim()).filter(l => l).length)

}, function(modId) { var map = {"./spawn.js":1653046641952}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046641949);
})()
//miniprogram-npm-outsideDeps=["url","path","npm-pick-manifest","fs","mkdirp","promise-inflight","lru-cache","@npmcli/promise-spawn","promise-retry","proc-log","semver","util"]
//# sourceMappingURL=index.js.map