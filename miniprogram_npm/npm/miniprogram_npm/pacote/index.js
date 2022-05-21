module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642317, function(require, module, exports) {
const { get } = require('./fetcher.js')
const GitFetcher = require('./git.js')
const RegistryFetcher = require('./registry.js')
const FileFetcher = require('./file.js')
const DirFetcher = require('./dir.js')
const RemoteFetcher = require('./remote.js')

module.exports = {
  GitFetcher,
  RegistryFetcher,
  FileFetcher,
  DirFetcher,
  RemoteFetcher,
  resolve: (spec, opts) => get(spec, opts).resolve(),
  extract: (spec, dest, opts) => get(spec, opts).extract(dest),
  manifest: (spec, opts) => get(spec, opts).manifest(),
  tarball: (spec, opts) => get(spec, opts).tarball(),
  packument: (spec, opts) => get(spec, opts).packument(),
}
module.exports.tarball.stream = (spec, handler, opts) =>
  get(spec, opts).tarballStream(handler)
module.exports.tarball.file = (spec, dest, opts) =>
  get(spec, opts).tarballFile(dest)

}, function(modId) {var map = {"./fetcher.js":1653046642318,"./git.js":1653046642322,"./registry.js":1653046642330,"./file.js":1653046642323,"./dir.js":1653046642326,"./remote.js":1653046642324}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642318, function(require, module, exports) {
// This is the base class that the other fetcher types in lib
// all descend from.
// It handles the unpacking and retry logic that is shared among
// all of the other Fetcher types.

const npa = require('npm-package-arg')
const ssri = require('ssri')
const { promisify } = require('util')
const { basename, dirname } = require('path')
const rimraf = promisify(require('rimraf'))
const tar = require('tar')
const log = require('proc-log')
const retry = require('promise-retry')
const fsm = require('fs-minipass')
const cacache = require('cacache')
const isPackageBin = require('./util/is-package-bin.js')
const removeTrailingSlashes = require('./util/trailing-slashes.js')
const getContents = require('@npmcli/installed-package-contents')
const readPackageJsonFast = require('read-package-json-fast')
const readPackageJson = promisify(require('read-package-json'))

// we only change ownership on unix platforms, and only if uid is 0
const selfOwner = process.getuid && process.getuid() === 0 ? {
  uid: 0,
  gid: process.getgid(),
} : null
const chownr = selfOwner ? promisify(require('chownr')) : null
const inferOwner = selfOwner ? require('infer-owner') : null
const mkdirp = require('mkdirp')
const cacheDir = require('./util/cache-dir.js')

// Private methods.
// Child classes should not have to override these.
// Users should never call them.
const _chown = Symbol('_chown')
const _extract = Symbol('_extract')
const _mkdir = Symbol('_mkdir')
const _empty = Symbol('_empty')
const _toFile = Symbol('_toFile')
const _tarxOptions = Symbol('_tarxOptions')
const _entryMode = Symbol('_entryMode')
const _istream = Symbol('_istream')
const _assertType = Symbol('_assertType')
const _tarballFromCache = Symbol('_tarballFromCache')
const _tarballFromResolved = Symbol.for('pacote.Fetcher._tarballFromResolved')
const _cacheFetches = Symbol.for('pacote.Fetcher._cacheFetches')
const _readPackageJson = Symbol.for('package.Fetcher._readPackageJson')

class FetcherBase {
  constructor (spec, opts) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('options object is required')
    }
    this.spec = npa(spec, opts.where)

    this.allowGitIgnore = !!opts.allowGitIgnore

    // a bit redundant because presumably the caller already knows this,
    // but it makes it easier to not have to keep track of the requested
    // spec when we're dispatching thousands of these at once, and normalizing
    // is nice.  saveSpec is preferred if set, because it turns stuff like
    // x/y#committish into github:x/y#committish.  use name@rawSpec for
    // registry deps so that we turn xyz and xyz@ -> xyz@
    this.from = this.spec.registry
      ? `${this.spec.name}@${this.spec.rawSpec}` : this.spec.saveSpec

    this[_assertType]()
    // clone the opts object so that others aren't upset when we mutate it
    // by adding/modifying the integrity value.
    this.opts = { ...opts }

    this.cache = opts.cache || cacheDir()
    this.resolved = opts.resolved || null

    // default to caching/verifying with sha512, that's what we usually have
    // need to change this default, or start overriding it, when sha512
    // is no longer strong enough.
    this.defaultIntegrityAlgorithm = opts.defaultIntegrityAlgorithm || 'sha512'

    if (typeof opts.integrity === 'string') {
      this.opts.integrity = ssri.parse(opts.integrity)
    }

    this.package = null
    this.type = this.constructor.name
    this.fmode = opts.fmode || 0o666
    this.dmode = opts.dmode || 0o777
    // we don't need a default umask, because we don't chmod files coming
    // out of package tarballs.  they're forced to have a mode that is
    // valid, regardless of what's in the tarball entry, and then we let
    // the process's umask setting do its job.  but if configured, we do
    // respect it.
    this.umask = opts.umask || 0

    this.preferOnline = !!opts.preferOnline
    this.preferOffline = !!opts.preferOffline
    this.offline = !!opts.offline

    this.before = opts.before
    this.fullMetadata = this.before ? true : !!opts.fullMetadata
    this.fullReadJson = !!opts.fullReadJson
    if (this.fullReadJson) {
      this[_readPackageJson] = readPackageJson
    } else {
      this[_readPackageJson] = readPackageJsonFast
    }

    this.defaultTag = opts.defaultTag || 'latest'
    this.registry = removeTrailingSlashes(opts.registry || 'https://registry.npmjs.org')

    // command to run 'prepare' scripts on directories and git dirs
    // To use pacote with yarn, for example, set npmBin to 'yarn'
    // and npmCliConfig with yarn's equivalents.
    this.npmBin = opts.npmBin || 'npm'

    // command to install deps for preparing
    this.npmInstallCmd = opts.npmInstallCmd || ['install', '--force']

    // XXX fill more of this in based on what we know from this.opts
    // we explicitly DO NOT fill in --tag, though, since we are often
    // going to be packing in the context of a publish, which may set
    // a dist-tag, but certainly wants to keep defaulting to latest.
    this.npmCliConfig = opts.npmCliConfig || [
      `--cache=${dirname(this.cache)}`,
      `--prefer-offline=${!!this.preferOffline}`,
      `--prefer-online=${!!this.preferOnline}`,
      `--offline=${!!this.offline}`,
      ...(this.before ? [`--before=${this.before.toISOString()}`] : []),
      '--no-progress',
      '--no-save',
      '--no-audit',
      // override any omit settings from the environment
      '--include=dev',
      '--include=peer',
      '--include=optional',
      // we need the actual things, not just the lockfile
      '--no-package-lock-only',
      '--no-dry-run',
    ]
  }

  get integrity () {
    return this.opts.integrity || null
  }

  set integrity (i) {
    if (!i) {
      return
    }

    i = ssri.parse(i)
    const current = this.opts.integrity

    // do not ever update an existing hash value, but do
    // merge in NEW algos and hashes that we don't already have.
    if (current) {
      current.merge(i)
    } else {
      this.opts.integrity = i
    }
  }

  get notImplementedError () {
    return new Error('not implemented in this fetcher type: ' + this.type)
  }

  // override in child classes
  // Returns a Promise that resolves to this.resolved string value
  resolve () {
    return this.resolved ? Promise.resolve(this.resolved)
      : Promise.reject(this.notImplementedError)
  }

  packument () {
    return Promise.reject(this.notImplementedError)
  }

  // override in child class
  // returns a manifest containing:
  // - name
  // - version
  // - _resolved
  // - _integrity
  // - plus whatever else was in there (corgi, full metadata, or pj file)
  manifest () {
    return Promise.reject(this.notImplementedError)
  }

  // private, should be overridden.
  // Note that they should *not* calculate or check integrity or cache,
  // but *just*  return the raw tarball data stream.
  [_tarballFromResolved] () {
    throw this.notImplementedError
  }

  // public, should not be overridden
  tarball () {
    return this.tarballStream(stream => stream.concat().then(data => {
      data.integrity = this.integrity && String(this.integrity)
      data.resolved = this.resolved
      data.from = this.from
      return data
    }))
  }

  // private
  // Note: cacache will raise a EINTEGRITY error if the integrity doesn't match
  [_tarballFromCache] () {
    return cacache.get.stream.byDigest(this.cache, this.integrity, this.opts)
  }

  get [_cacheFetches] () {
    return true
  }

  [_istream] (stream) {
    // everyone will need one of these, either for verifying or calculating
    // We always set it, because we have might only have a weak legacy hex
    // sha1 in the packument, and this MAY upgrade it to a stronger algo.
    // If we had an integrity, and it doesn't match, then this does not
    // override that error; the istream will raise the error before it
    // gets to the point of re-setting the integrity.
    const istream = ssri.integrityStream(this.opts)
    istream.on('integrity', i => this.integrity = i)
    stream.on('error', er => istream.emit('error', er))

    // if not caching this, just pipe through to the istream and return it
    if (!this.opts.cache || !this[_cacheFetches]) {
      return stream.pipe(istream)
    }

    // we have to return a stream that gets ALL the data, and proxies errors,
    // but then pipe from the original tarball stream into the cache as well.
    // To do this without losing any data, and since the cacache put stream
    // is not a passthrough, we have to pipe from the original stream into
    // the cache AFTER we pipe into the istream.  Since the cache stream
    // has an asynchronous flush to write its contents to disk, we need to
    // defer the istream end until the cache stream ends.
    stream.pipe(istream, { end: false })
    const cstream = cacache.put.stream(
      this.opts.cache,
      `pacote:tarball:${this.from}`,
      this.opts
    )
    stream.pipe(cstream)
    // defer istream end until after cstream
    // cache write errors should not crash the fetch, this is best-effort.
    cstream.promise().catch(() => {}).then(() => istream.end())

    return istream
  }

  pickIntegrityAlgorithm () {
    return this.integrity ? this.integrity.pickAlgorithm(this.opts)
      : this.defaultIntegrityAlgorithm
  }

  // TODO: check error class, once those are rolled out to our deps
  isDataCorruptionError (er) {
    return er.code === 'EINTEGRITY' || er.code === 'Z_DATA_ERROR'
  }

  // override the types getter
  get types () {}
  [_assertType] () {
    if (this.types && !this.types.includes(this.spec.type)) {
      throw new TypeError(`Wrong spec type (${
        this.spec.type
      }) for ${
        this.constructor.name
      }. Supported types: ${this.types.join(', ')}`)
    }
  }

  // We allow ENOENTs from cacache, but not anywhere else.
  // An ENOENT trying to read a tgz file, for example, is Right Out.
  isRetriableError (er) {
    // TODO: check error class, once those are rolled out to our deps
    return this.isDataCorruptionError(er) ||
      er.code === 'ENOENT' ||
      er.code === 'EISDIR'
  }

  // Mostly internal, but has some uses
  // Pass in a function which returns a promise
  // Function will be called 1 or more times with streams that may fail.
  // Retries:
  // Function MUST handle errors on the stream by rejecting the promise,
  // so that retry logic can pick it up and either retry or fail whatever
  // promise it was making (ie, failing extraction, etc.)
  //
  // The return value of this method is a Promise that resolves the same
  // as whatever the streamHandler resolves to.
  //
  // This should never be overridden by child classes, but it is public.
  tarballStream (streamHandler) {
    // Only short-circuit via cache if we have everything else we'll need,
    // and the user has not expressed a preference for checking online.

    const fromCache = (
      !this.preferOnline &&
      this.integrity &&
      this.resolved
    ) ? streamHandler(this[_tarballFromCache]()).catch(er => {
        if (this.isDataCorruptionError(er)) {
          log.warn('tarball', `cached data for ${
          this.spec
        } (${this.integrity}) seems to be corrupted. Refreshing cache.`)
          return this.cleanupCached().then(() => {
            throw er
          })
        } else {
          throw er
        }
      }) : null

    const fromResolved = er => {
      if (er) {
        if (!this.isRetriableError(er)) {
          throw er
        }
        log.silly('tarball', `no local data for ${
          this.spec
        }. Extracting by manifest.`)
      }
      return this.resolve().then(() => retry(tryAgain =>
        streamHandler(this[_istream](this[_tarballFromResolved]()))
          .catch(er => {
          // Most likely data integrity.  A cache ENOENT error is unlikely
          // here, since we're definitely not reading from the cache, but it
          // IS possible that the fetch subsystem accessed the cache, and the
          // entry got blown away or something.  Try one more time to be sure.
            if (this.isRetriableError(er)) {
              log.warn('tarball', `tarball data for ${
              this.spec
            } (${this.integrity}) seems to be corrupted. Trying again.`)
              return this.cleanupCached().then(() => tryAgain(er))
            }
            throw er
          }), { retries: 1, minTimeout: 0, maxTimeout: 0 }))
    }

    return fromCache ? fromCache.catch(fromResolved) : fromResolved()
  }

  cleanupCached () {
    return cacache.rm.content(this.cache, this.integrity, this.opts)
  }

  async [_chown] (path, uid, gid) {
    return selfOwner && (selfOwner.gid !== gid || selfOwner.uid !== uid)
      ? chownr(path, uid, gid)
      : /* istanbul ignore next - we don't test in root-owned folders */ null
  }

  [_empty] (path) {
    return getContents({ path, depth: 1 }).then(contents => Promise.all(
      contents.map(entry => rimraf(entry))))
  }

  [_mkdir] (dest) {
    // if we're bothering to do owner inference, then do it.
    // otherwise just make the dir, and return an empty object.
    // always empty the dir dir to start with, but do so
    // _after_ inferring the owner, in case there's an existing folder
    // there that we would want to preserve which differs from the
    // parent folder (rare, but probably happens sometimes).
    return !inferOwner
      ? this[_empty](dest).then(() => mkdirp(dest)).then(() => ({}))
      : inferOwner(dest).then(({ uid, gid }) =>
        this[_empty](dest)
          .then(() => mkdirp(dest))
          .then(made => {
            // ignore the || dest part in coverage.  It's there to handle
            // race conditions where the dir may be made by someone else
            // after being removed by us.
            const dir = made || /* istanbul ignore next */ dest
            return this[_chown](dir, uid, gid)
          })
          .then(() => ({ uid, gid })))
  }

  // extraction is always the same.  the only difference is where
  // the tarball comes from.
  extract (dest) {
    return this[_mkdir](dest).then(({ uid, gid }) =>
      this.tarballStream(tarball => this[_extract](dest, tarball, uid, gid)))
  }

  [_toFile] (dest) {
    return this.tarballStream(str => new Promise((res, rej) => {
      const writer = new fsm.WriteStream(dest)
      str.on('error', er => writer.emit('error', er))
      writer.on('error', er => rej(er))
      writer.on('close', () => res({
        integrity: this.integrity && String(this.integrity),
        resolved: this.resolved,
        from: this.from,
      }))
      str.pipe(writer)
    }))
  }

  // don't use this[_mkdir] because we don't want to rimraf anything
  tarballFile (dest) {
    const dir = dirname(dest)
    return !inferOwner
      ? mkdirp(dir).then(() => this[_toFile](dest))
      : inferOwner(dest).then(({ uid, gid }) =>
        mkdirp(dir).then(made => this[_toFile](dest)
          .then(res => this[_chown](made || dir, uid, gid)
            .then(() => res))))
  }

  [_extract] (dest, tarball, uid, gid) {
    const extractor = tar.x(this[_tarxOptions]({ cwd: dest, uid, gid }))
    const p = new Promise((resolve, reject) => {
      extractor.on('end', () => {
        resolve({
          resolved: this.resolved,
          integrity: this.integrity && String(this.integrity),
          from: this.from,
        })
      })

      extractor.on('error', er => {
        log.warn('tar', er.message)
        log.silly('tar', er)
        reject(er)
      })

      tarball.on('error', er => reject(er))
    })

    tarball.pipe(extractor)
    return p
  }

  // always ensure that entries are at least as permissive as our configured
  // dmode/fmode, but never more permissive than the umask allows.
  [_entryMode] (path, mode, type) {
    const m = /Directory|GNUDumpDir/.test(type) ? this.dmode
      : /File$/.test(type) ? this.fmode
      : /* istanbul ignore next - should never happen in a pkg */ 0

    // make sure package bins are executable
    const exe = isPackageBin(this.package, path) ? 0o111 : 0
    // always ensure that files are read/writable by the owner
    return ((mode | m) & ~this.umask) | exe | 0o600
  }

  [_tarxOptions] ({ cwd, uid, gid }) {
    const sawIgnores = new Set()
    return {
      cwd,
      noChmod: true,
      noMtime: true,
      filter: (name, entry) => {
        if (/Link$/.test(entry.type)) {
          return false
        }
        entry.mode = this[_entryMode](entry.path, entry.mode, entry.type)
        // this replicates the npm pack behavior where .gitignore files
        // are treated like .npmignore files, but only if a .npmignore
        // file is not present.
        if (/File$/.test(entry.type)) {
          const base = basename(entry.path)
          if (base === '.npmignore') {
            sawIgnores.add(entry.path)
          } else if (base === '.gitignore' && !this.allowGitIgnore) {
            // rename, but only if there's not already a .npmignore
            const ni = entry.path.replace(/\.gitignore$/, '.npmignore')
            if (sawIgnores.has(ni)) {
              return false
            }
            entry.path = ni
          }
          return true
        }
      },
      strip: 1,
      onwarn: /* istanbul ignore next - we can trust that tar logs */
      (code, msg, data) => {
        log.warn('tar', code, msg)
        log.silly('tar', code, msg, data)
      },
      uid,
      gid,
      umask: this.umask,
    }
  }
}

module.exports = FetcherBase

// Child classes
const GitFetcher = require('./git.js')
const RegistryFetcher = require('./registry.js')
const FileFetcher = require('./file.js')
const DirFetcher = require('./dir.js')
const RemoteFetcher = require('./remote.js')

// Get an appropriate fetcher object from a spec and options
FetcherBase.get = (rawSpec, opts = {}) => {
  const spec = npa(rawSpec, opts.where)
  switch (spec.type) {
    case 'git':
      return new GitFetcher(spec, opts)

    case 'remote':
      return new RemoteFetcher(spec, opts)

    case 'version':
    case 'range':
    case 'tag':
    case 'alias':
      return new RegistryFetcher(spec.subSpec || spec, opts)

    case 'file':
      return new FileFetcher(spec, opts)

    case 'directory':
      return new DirFetcher(spec, opts)

    default:
      throw new TypeError('Unknown spec type: ' + spec.type)
  }
}

}, function(modId) { var map = {"./util/is-package-bin.js":1653046642319,"./util/trailing-slashes.js":1653046642320,"./util/cache-dir.js":1653046642321,"./git.js":1653046642322,"./registry.js":1653046642330,"./file.js":1653046642323,"./dir.js":1653046642326,"./remote.js":1653046642324}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642319, function(require, module, exports) {
// Function to determine whether a path is in the package.bin set.
// Used to prevent issues when people publish a package from a
// windows machine, and then install with --no-bin-links.
//
// Note: this is not possible in remote or file fetchers, since
// we don't have the manifest until AFTER we've unpacked.  But the
// main use case is registry fetching with git a distant second,
// so that's an acceptable edge case to not handle.

const binObj = (name, bin) =>
  typeof bin === 'string' ? { [name]: bin } : bin

const hasBin = (pkg, path) => {
  const bin = binObj(pkg.name, pkg.bin)
  const p = path.replace(/^[^\\/]*\//, '')
  for (const kv of Object.entries(bin)) {
    if (kv[1] === p) {
      return true
    }
  }
  return false
}

module.exports = (pkg, path) =>
  pkg && pkg.bin ? hasBin(pkg, path) : false

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642320, function(require, module, exports) {
const removeTrailingSlashes = (input) => {
  // in order to avoid regexp redos detection
  let output = input
  while (output.endsWith('/')) {
    output = output.substr(0, output.length - 1)
  }
  return output
}

module.exports = removeTrailingSlashes

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642321, function(require, module, exports) {
const os = require('os')
const { resolve } = require('path')

module.exports = (fakePlatform = false) => {
  const temp = os.tmpdir()
  const uidOrPid = process.getuid ? process.getuid() : process.pid
  const home = os.homedir() || resolve(temp, 'npm-' + uidOrPid)
  const platform = fakePlatform || process.platform
  const cacheExtra = platform === 'win32' ? 'npm-cache' : '.npm'
  const cacheRoot = (platform === 'win32' && process.env.LOCALAPPDATA) || home
  return resolve(cacheRoot, cacheExtra, '_cacache')
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642322, function(require, module, exports) {
const Fetcher = require('./fetcher.js')
const FileFetcher = require('./file.js')
const RemoteFetcher = require('./remote.js')
const DirFetcher = require('./dir.js')
const hashre = /^[a-f0-9]{40}$/
const git = require('@npmcli/git')
const pickManifest = require('npm-pick-manifest')
const npa = require('npm-package-arg')
const Minipass = require('minipass')
const cacache = require('cacache')
const log = require('proc-log')
const npm = require('./util/npm.js')

const _resolvedFromRepo = Symbol('_resolvedFromRepo')
const _resolvedFromHosted = Symbol('_resolvedFromHosted')
const _resolvedFromClone = Symbol('_resolvedFromClone')
const _tarballFromResolved = Symbol.for('pacote.Fetcher._tarballFromResolved')
const _addGitSha = Symbol('_addGitSha')
const addGitSha = require('./util/add-git-sha.js')
const _clone = Symbol('_clone')
const _cloneHosted = Symbol('_cloneHosted')
const _cloneRepo = Symbol('_cloneRepo')
const _setResolvedWithSha = Symbol('_setResolvedWithSha')
const _prepareDir = Symbol('_prepareDir')
const _readPackageJson = Symbol.for('package.Fetcher._readPackageJson')

// get the repository url.
// prefer https if there's auth, since ssh will drop that.
// otherwise, prefer ssh if available (more secure).
// We have to add the git+ back because npa suppresses it.
const repoUrl = (h, opts) =>
  h.sshurl && !(h.https && h.auth) && addGitPlus(h.sshurl(opts)) ||
  h.https && addGitPlus(h.https(opts))

// add git+ to the url, but only one time.
const addGitPlus = url => url && `git+${url}`.replace(/^(git\+)+/, 'git+')

class GitFetcher extends Fetcher {
  constructor (spec, opts) {
    super(spec, opts)

    // we never want to compare integrity for git dependencies: npm/rfcs#525
    if (this.opts.integrity) {
      delete this.opts.integrity
      log.warn(`skipping integrity check for git dependency ${this.spec.fetchSpec}`)
    }

    this.resolvedRef = null
    if (this.spec.hosted) {
      this.from = this.spec.hosted.shortcut({ noCommittish: false })
    }

    // shortcut: avoid full clone when we can go straight to the tgz
    // if we have the full sha and it's a hosted git platform
    if (this.spec.gitCommittish && hashre.test(this.spec.gitCommittish)) {
      this.resolvedSha = this.spec.gitCommittish
      // use hosted.tarball() when we shell to RemoteFetcher later
      this.resolved = this.spec.hosted
        ? repoUrl(this.spec.hosted, { noCommittish: false })
        : this.spec.rawSpec
    } else {
      this.resolvedSha = ''
    }
  }

  // just exposed to make it easier to test all the combinations
  static repoUrl (hosted, opts) {
    return repoUrl(hosted, opts)
  }

  get types () {
    return ['git']
  }

  resolve () {
    // likely a hosted git repo with a sha, so get the tarball url
    // but in general, no reason to resolve() more than necessary!
    if (this.resolved) {
      return super.resolve()
    }

    // fetch the git repo and then look at the current hash
    const h = this.spec.hosted
    // try to use ssh, fall back to git.
    return h ? this[_resolvedFromHosted](h)
      : this[_resolvedFromRepo](this.spec.fetchSpec)
  }

  // first try https, since that's faster and passphrase-less for
  // public repos, and supports private repos when auth is provided.
  // Fall back to SSH to support private repos
  // NB: we always store the https url in resolved field if auth
  // is present, otherwise ssh if the hosted type provides it
  [_resolvedFromHosted] (hosted) {
    return this[_resolvedFromRepo](hosted.https && hosted.https())
      .catch(er => {
        // Throw early since we know pathspec errors will fail again if retried
        if (er instanceof git.errors.GitPathspecError) {
          throw er
        }
        const ssh = hosted.sshurl && hosted.sshurl()
        // no fallthrough if we can't fall through or have https auth
        if (!ssh || hosted.auth) {
          throw er
        }
        return this[_resolvedFromRepo](ssh)
      })
  }

  [_resolvedFromRepo] (gitRemote) {
    // XXX make this a custom error class
    if (!gitRemote) {
      return Promise.reject(new Error(`No git url for ${this.spec}`))
    }
    const gitRange = this.spec.gitRange
    const name = this.spec.name
    return git.revs(gitRemote, this.opts).then(remoteRefs => {
      return gitRange ? pickManifest({
        versions: remoteRefs.versions,
        'dist-tags': remoteRefs['dist-tags'],
        name,
      }, gitRange, this.opts)
        : this.spec.gitCommittish ?
          remoteRefs.refs[this.spec.gitCommittish] ||
          remoteRefs.refs[remoteRefs.shas[this.spec.gitCommittish]]
          : remoteRefs.refs.HEAD // no git committish, get default head
    }).then(revDoc => {
      // the committish provided isn't in the rev list
      // things like HEAD~3 or @yesterday can land here.
      if (!revDoc || !revDoc.sha) {
        return this[_resolvedFromClone]()
      }

      this.resolvedRef = revDoc
      this.resolvedSha = revDoc.sha
      this[_addGitSha](revDoc.sha)
      return this.resolved
    })
  }

  [_setResolvedWithSha] (withSha) {
    // we haven't cloned, so a tgz download is still faster
    // of course, if it's not a known host, we can't do that.
    this.resolved = !this.spec.hosted ? withSha
      : repoUrl(npa(withSha).hosted, { noCommittish: false })
  }

  // when we get the git sha, we affix it to our spec to build up
  // either a git url with a hash, or a tarball download URL
  [_addGitSha] (sha) {
    this[_setResolvedWithSha](addGitSha(this.spec, sha))
  }

  [_resolvedFromClone] () {
    // do a full or shallow clone, then look at the HEAD
    // kind of wasteful, but no other option, really
    return this[_clone](dir => this.resolved)
  }

  [_prepareDir] (dir) {
    return this[_readPackageJson](dir + '/package.json').then(mani => {
      // no need if we aren't going to do any preparation.
      const scripts = mani.scripts
      if (!mani.workspaces && (!scripts || !(
        scripts.postinstall ||
          scripts.build ||
          scripts.preinstall ||
          scripts.install ||
          scripts.prepack ||
          scripts.prepare))) {
        return
      }

      // to avoid cases where we have an cycle of git deps that depend
      // on one another, we only ever do preparation for one instance
      // of a given git dep along the chain of installations.
      // Note that this does mean that a dependency MAY in theory end up
      // trying to run its prepare script using a dependency that has not
      // been properly prepared itself, but that edge case is smaller
      // and less hazardous than a fork bomb of npm and git commands.
      const noPrepare = !process.env._PACOTE_NO_PREPARE_ ? []
        : process.env._PACOTE_NO_PREPARE_.split('\n')
      if (noPrepare.includes(this.resolved)) {
        log.info('prepare', 'skip prepare, already seen', this.resolved)
        return
      }
      noPrepare.push(this.resolved)

      // the DirFetcher will do its own preparation to run the prepare scripts
      // All we have to do is put the deps in place so that it can succeed.
      return npm(
        this.npmBin,
        [].concat(this.npmInstallCmd).concat(this.npmCliConfig),
        dir,
        { ...process.env, _PACOTE_NO_PREPARE_: noPrepare.join('\n') },
        { message: 'git dep preparation failed' }
      )
    })
  }

  [_tarballFromResolved] () {
    const stream = new Minipass()
    stream.resolved = this.resolved
    stream.from = this.from

    // check it out and then shell out to the DirFetcher tarball packer
    this[_clone](dir => this[_prepareDir](dir)
      .then(() => new Promise((res, rej) => {
        const df = new DirFetcher(`file:${dir}`, {
          ...this.opts,
          resolved: null,
          integrity: null,
        })
        const dirStream = df[_tarballFromResolved]()
        dirStream.on('error', rej)
        dirStream.on('end', res)
        dirStream.pipe(stream)
      }))).catch(
      /* istanbul ignore next: very unlikely and hard to test */
      er => stream.emit('error', er)
    )
    return stream
  }

  // clone a git repo into a temp folder (or fetch and unpack if possible)
  // handler accepts a directory, and returns a promise that resolves
  // when we're done with it, at which point, cacache deletes it
  //
  // TODO: after cloning, create a tarball of the folder, and add to the cache
  // with cacache.put.stream(), using a key that's deterministic based on the
  // spec and repo, so that we don't ever clone the same thing multiple times.
  [_clone] (handler, tarballOk = true) {
    const o = { tmpPrefix: 'git-clone' }
    const ref = this.resolvedSha || this.spec.gitCommittish
    const h = this.spec.hosted
    const resolved = this.resolved

    // can be set manually to false to fall back to actual git clone
    tarballOk = tarballOk &&
      h && resolved === repoUrl(h, { noCommittish: false }) && h.tarball

    return cacache.tmp.withTmp(this.cache, o, tmp => {
      // if we're resolved, and have a tarball url, shell out to RemoteFetcher
      if (tarballOk) {
        const nameat = this.spec.name ? `${this.spec.name}@` : ''
        return new RemoteFetcher(h.tarball({ noCommittish: false }), {
          ...this.opts,
          allowGitIgnore: true,
          pkgid: `git:${nameat}${this.resolved}`,
          resolved: this.resolved,
          integrity: null, // it'll always be different, if we have one
        }).extract(tmp).then(() => handler(tmp), er => {
          // fall back to ssh download if tarball fails
          if (er.constructor.name.match(/^Http/)) {
            return this[_clone](handler, false)
          } else {
            throw er
          }
        })
      }

      return (
        h ? this[_cloneHosted](ref, tmp)
        : this[_cloneRepo](this.spec.fetchSpec, ref, tmp)
      ).then(sha => {
        this.resolvedSha = sha
        if (!this.resolved) {
          this[_addGitSha](sha)
        }
      })
        .then(() => handler(tmp))
    })
  }

  // first try https, since that's faster and passphrase-less for
  // public repos, and supports private repos when auth is provided.
  // Fall back to SSH to support private repos
  // NB: we always store the https url in resolved field if auth
  // is present, otherwise ssh if the hosted type provides it
  [_cloneHosted] (ref, tmp) {
    const hosted = this.spec.hosted
    return this[_cloneRepo](hosted.https({ noCommittish: true }), ref, tmp)
      .catch(er => {
        // Throw early since we know pathspec errors will fail again if retried
        if (er instanceof git.errors.GitPathspecError) {
          throw er
        }
        const ssh = hosted.sshurl && hosted.sshurl({ noCommittish: true })
        // no fallthrough if we can't fall through or have https auth
        if (!ssh || hosted.auth) {
          throw er
        }
        return this[_cloneRepo](ssh, ref, tmp)
      })
  }

  [_cloneRepo] (repo, ref, tmp) {
    const { opts, spec } = this
    return git.clone(repo, ref, tmp, { ...opts, spec })
  }

  manifest () {
    if (this.package) {
      return Promise.resolve(this.package)
    }

    return this.spec.hosted && this.resolved
      ? FileFetcher.prototype.manifest.apply(this)
      : this[_clone](dir =>
        this[_readPackageJson](dir + '/package.json')
          .then(mani => this.package = {
            ...mani,
            _resolved: this.resolved,
            _from: this.from,
          }))
  }

  packument () {
    return FileFetcher.prototype.packument.apply(this)
  }
}
module.exports = GitFetcher

}, function(modId) { var map = {"./fetcher.js":1653046642318,"./file.js":1653046642323,"./remote.js":1653046642324,"./dir.js":1653046642326,"./util/npm.js":1653046642328,"./util/add-git-sha.js":1653046642329}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642323, function(require, module, exports) {
const Fetcher = require('./fetcher.js')
const fsm = require('fs-minipass')
const cacache = require('cacache')
const _tarballFromResolved = Symbol.for('pacote.Fetcher._tarballFromResolved')
const _exeBins = Symbol('_exeBins')
const { resolve } = require('path')
const fs = require('fs')
const _readPackageJson = Symbol.for('package.Fetcher._readPackageJson')

class FileFetcher extends Fetcher {
  constructor (spec, opts) {
    super(spec, opts)
    // just the fully resolved filename
    this.resolved = this.spec.fetchSpec
  }

  get types () {
    return ['file']
  }

  manifest () {
    if (this.package) {
      return Promise.resolve(this.package)
    }

    // have to unpack the tarball for this.
    return cacache.tmp.withTmp(this.cache, this.opts, dir =>
      this.extract(dir)
        .then(() => this[_readPackageJson](dir + '/package.json'))
        .then(mani => this.package = {
          ...mani,
          _integrity: this.integrity && String(this.integrity),
          _resolved: this.resolved,
          _from: this.from,
        }))
  }

  [_exeBins] (pkg, dest) {
    if (!pkg.bin) {
      return Promise.resolve()
    }

    return Promise.all(Object.keys(pkg.bin).map(k => new Promise(res => {
      const script = resolve(dest, pkg.bin[k])
      // Best effort.  Ignore errors here, the only result is that
      // a bin script is not executable.  But if it's missing or
      // something, we just leave it for a later stage to trip over
      // when we can provide a more useful contextual error.
      fs.stat(script, (er, st) => {
        if (er) {
          return res()
        }
        const mode = st.mode | 0o111
        if (mode === st.mode) {
          return res()
        }
        fs.chmod(script, mode, res)
      })
    })))
  }

  extract (dest) {
    // if we've already loaded the manifest, then the super got it.
    // but if not, read the unpacked manifest and chmod properly.
    return super.extract(dest)
      .then(result => this.package ? result
      : this[_readPackageJson](dest + '/package.json').then(pkg =>
        this[_exeBins](pkg, dest)).then(() => result))
  }

  [_tarballFromResolved] () {
    // create a read stream and return it
    return new fsm.ReadStream(this.resolved)
  }

  packument () {
    // simulate based on manifest
    return this.manifest().then(mani => ({
      name: mani.name,
      'dist-tags': {
        [this.defaultTag]: mani.version,
      },
      versions: {
        [mani.version]: {
          ...mani,
          dist: {
            tarball: `file:${this.resolved}`,
            integrity: this.integrity && String(this.integrity),
          },
        },
      },
    }))
  }
}

module.exports = FileFetcher

}, function(modId) { var map = {"./fetcher.js":1653046642318}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642324, function(require, module, exports) {
const Fetcher = require('./fetcher.js')
const FileFetcher = require('./file.js')
const _tarballFromResolved = Symbol.for('pacote.Fetcher._tarballFromResolved')
const pacoteVersion = require('../package.json').version
const fetch = require('npm-registry-fetch')
const Minipass = require('minipass')
// The default registry URL is a string of great magic.
const magic = /^https?:\/\/registry\.npmjs\.org\//

const _cacheFetches = Symbol.for('pacote.Fetcher._cacheFetches')
const _headers = Symbol('_headers')
class RemoteFetcher extends Fetcher {
  constructor (spec, opts) {
    super(spec, opts)
    this.resolved = this.spec.fetchSpec
    if (magic.test(this.resolved) && !magic.test(this.registry + '/')) {
      this.resolved = this.resolved.replace(magic, this.registry + '/')
    }

    // nam is a fermented pork sausage that is good to eat
    const nameat = this.spec.name ? `${this.spec.name}@` : ''
    this.pkgid = opts.pkgid ? opts.pkgid : `remote:${nameat}${this.resolved}`
  }

  // Don't need to cache tarball fetches in pacote, because make-fetch-happen
  // will write into cacache anyway.
  get [_cacheFetches] () {
    return false
  }

  [_tarballFromResolved] () {
    const stream = new Minipass()
    const fetchOpts = {
      ...this.opts,
      headers: this[_headers](),
      spec: this.spec,
      integrity: this.integrity,
      algorithms: [this.pickIntegrityAlgorithm()],
    }
    fetch(this.resolved, fetchOpts).then(res => {
      const hash = res.headers.get('x-local-cache-hash')
      if (hash) {
        this.integrity = decodeURIComponent(hash)
      }

      res.body.on('error',
        /* istanbul ignore next - exceedingly rare and hard to simulate */
        er => stream.emit('error', er)
      ).pipe(stream)
    }).catch(er => stream.emit('error', er))

    return stream
  }

  [_headers] () {
    return {
      // npm will override this, but ensure that we always send *something*
      'user-agent': this.opts.userAgent ||
        `pacote/${pacoteVersion} node/${process.version}`,
      ...(this.opts.headers || {}),
      'pacote-version': pacoteVersion,
      'pacote-req-type': 'tarball',
      'pacote-pkg-id': this.pkgid,
      ...(this.integrity ? { 'pacote-integrity': String(this.integrity) }
      : {}),
      ...(this.opts.headers || {}),
    }
  }

  get types () {
    return ['remote']
  }

  // getting a packument and/or manifest is the same as with a file: spec.
  // unpack the tarball stream, and then read from the package.json file.
  packument () {
    return FileFetcher.prototype.packument.apply(this)
  }

  manifest () {
    return FileFetcher.prototype.manifest.apply(this)
  }
}
module.exports = RemoteFetcher

}, function(modId) { var map = {"./fetcher.js":1653046642318,"./file.js":1653046642323,"../package.json":1653046642325}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642325, function(require, module, exports) {
module.exports = {
  "name": "pacote",
  "version": "13.0.5",
  "description": "JavaScript package downloader",
  "author": "GitHub Inc.",
  "bin": {
    "pacote": "lib/bin.js"
  },
  "license": "ISC",
  "main": "lib/index.js",
  "scripts": {
    "test": "tap",
    "snap": "tap",
    "preversion": "npm test",
    "postversion": "npm publish",
    "prepublishOnly": "git push origin --follow-tags",
    "lint": "eslint '**/*.js'",
    "postlint": "npm-template-check",
    "lintfix": "npm run lint -- --fix",
    "posttest": "npm run lint",
    "template-copy": "npm-template-copy --force"
  },
  "tap": {
    "timeout": 300,
    "coverage-map": "map.js"
  },
  "devDependencies": {
    "@npmcli/template-oss": "^2.9.2",
    "mutate-fs": "^2.1.1",
    "npm-registry-mock": "^1.3.1",
    "tap": "^15.1.6"
  },
  "files": [
    "bin",
    "lib"
  ],
  "keywords": [
    "packages",
    "npm",
    "git"
  ],
  "dependencies": {
    "@npmcli/git": "^3.0.0",
    "@npmcli/installed-package-contents": "^1.0.7",
    "@npmcli/promise-spawn": "^1.2.0",
    "@npmcli/run-script": "^3.0.1",
    "cacache": "^16.0.0",
    "chownr": "^2.0.0",
    "fs-minipass": "^2.1.0",
    "infer-owner": "^1.0.4",
    "minipass": "^3.1.6",
    "mkdirp": "^1.0.4",
    "npm-package-arg": "^9.0.0",
    "npm-packlist": "^4.0.0",
    "npm-pick-manifest": "^7.0.0",
    "npm-registry-fetch": "^13.0.1",
    "proc-log": "^2.0.0",
    "promise-retry": "^2.0.1",
    "read-package-json": "^5.0.0",
    "read-package-json-fast": "^2.0.3",
    "rimraf": "^3.0.2",
    "ssri": "^8.0.1",
    "tar": "^6.1.11"
  },
  "engines": {
    "node": "^12.13.0 || ^14.15.0 || >=16"
  },
  "repository": "git@github.com:npm/pacote",
  "templateOSS": {
    "version": "2.9.2",
    "windowsCI": false
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642326, function(require, module, exports) {
const Fetcher = require('./fetcher.js')
const FileFetcher = require('./file.js')
const Minipass = require('minipass')
const tarCreateOptions = require('./util/tar-create-options.js')
const packlist = require('npm-packlist')
const tar = require('tar')
const _prepareDir = Symbol('_prepareDir')
const { resolve } = require('path')
const _readPackageJson = Symbol.for('package.Fetcher._readPackageJson')

const runScript = require('@npmcli/run-script')

const _tarballFromResolved = Symbol.for('pacote.Fetcher._tarballFromResolved')
class DirFetcher extends Fetcher {
  constructor (spec, opts) {
    super(spec, opts)
    // just the fully resolved filename
    this.resolved = this.spec.fetchSpec
  }

  // exposes tarCreateOptions as public API
  static tarCreateOptions (manifest) {
    return tarCreateOptions(manifest)
  }

  get types () {
    return ['directory']
  }

  [_prepareDir] () {
    return this.manifest().then(mani => {
      if (!mani.scripts || !mani.scripts.prepare) {
        return
      }

      // we *only* run prepare.
      // pre/post-pack is run by the npm CLI for publish and pack,
      // but this function is *also* run when installing git deps
      const stdio = this.opts.foregroundScripts ? 'inherit' : 'pipe'

      // hide the banner if silent opt is passed in, or if prepare running
      // in the background.
      const banner = this.opts.silent ? false : stdio === 'inherit'

      return runScript({
        pkg: mani,
        event: 'prepare',
        path: this.resolved,
        stdioString: true,
        stdio,
        banner,
        env: {
          npm_package_resolved: this.resolved,
          npm_package_integrity: this.integrity,
          npm_package_json: resolve(this.resolved, 'package.json'),
        },
      })
    })
  }

  [_tarballFromResolved] () {
    const stream = new Minipass()
    stream.resolved = this.resolved
    stream.integrity = this.integrity

    // run the prepare script, get the list of files, and tar it up
    // pipe to the stream, and proxy errors the chain.
    this[_prepareDir]()
      .then(() => packlist({ path: this.resolved }))
      .then(files => tar.c(tarCreateOptions(this.package), files)
        .on('error', er => stream.emit('error', er)).pipe(stream))
      .catch(er => stream.emit('error', er))
    return stream
  }

  manifest () {
    if (this.package) {
      return Promise.resolve(this.package)
    }

    return this[_readPackageJson](this.resolved + '/package.json')
      .then(mani => this.package = {
        ...mani,
        _integrity: this.integrity && String(this.integrity),
        _resolved: this.resolved,
        _from: this.from,
      })
  }

  packument () {
    return FileFetcher.prototype.packument.apply(this)
  }
}
module.exports = DirFetcher

}, function(modId) { var map = {"./fetcher.js":1653046642318,"./file.js":1653046642323,"./util/tar-create-options.js":1653046642327}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642327, function(require, module, exports) {
const isPackageBin = require('./is-package-bin.js')

const tarCreateOptions = manifest => ({
  cwd: manifest._resolved,
  prefix: 'package/',
  portable: true,
  gzip: {
    // forcing the level to 9 seems to avoid some
    // platform specific optimizations that cause
    // integrity mismatch errors due to differing
    // end results after compression
    level: 9,
  },

  // ensure that package bins are always executable
  // Note that npm-packlist is already filtering out
  // anything that is not a regular file, ignored by
  // .npmignore or package.json "files", etc.
  filter: (path, stat) => {
    if (isPackageBin(manifest, path)) {
      stat.mode |= 0o111
    }
    return true
  },

  // Provide a specific date in the 1980s for the benefit of zip,
  // which is confounded by files dated at the Unix epoch 0.
  mtime: new Date('1985-10-26T08:15:00.000Z'),
})

module.exports = tarCreateOptions

}, function(modId) { var map = {"./is-package-bin.js":1653046642319}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642328, function(require, module, exports) {
// run an npm command
const spawn = require('@npmcli/promise-spawn')

module.exports = (npmBin, npmCommand, cwd, env, extra) => {
  const isJS = npmBin.endsWith('.js')
  const cmd = isJS ? process.execPath : npmBin
  const args = (isJS ? [npmBin] : []).concat(npmCommand)
  // when installing to run the `prepare` script for a git dep, we need
  // to ensure that we don't run into a cycle of checking out packages
  // in temp directories.  this lets us link previously-seen repos that
  // are also being prepared.

  return spawn(cmd, args, { cwd, stdioString: true, env }, extra)
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642329, function(require, module, exports) {
// add a sha to a git remote url spec
const addGitSha = (spec, sha) => {
  if (spec.hosted) {
    const h = spec.hosted
    const opt = { noCommittish: true }
    const base = h.https && h.auth ? h.https(opt) : h.shortcut(opt)

    return `${base}#${sha}`
  } else {
    // don't use new URL for this, because it doesn't handle scp urls
    return spec.rawSpec.replace(/#.*$/, '') + `#${sha}`
  }
}

module.exports = addGitSha

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642330, function(require, module, exports) {
const Fetcher = require('./fetcher.js')
const RemoteFetcher = require('./remote.js')
const _tarballFromResolved = Symbol.for('pacote.Fetcher._tarballFromResolved')
const pacoteVersion = require('../package.json').version
const removeTrailingSlashes = require('./util/trailing-slashes.js')
const npa = require('npm-package-arg')
const rpj = require('read-package-json-fast')
const pickManifest = require('npm-pick-manifest')
const ssri = require('ssri')

// Corgis are cute. 🐕🐶
const corgiDoc = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'
const fullDoc = 'application/json'

const fetch = require('npm-registry-fetch')

// TODO: memoize reg requests, so we don't even have to check cache

const _headers = Symbol('_headers')
class RegistryFetcher extends Fetcher {
  constructor (spec, opts) {
    super(spec, opts)

    // you usually don't want to fetch the same packument multiple times in
    // the span of a given script or command, no matter how many pacote calls
    // are made, so this lets us avoid doing that.  It's only relevant for
    // registry fetchers, because other types simulate their packument from
    // the manifest, which they memoize on this.package, so it's very cheap
    // already.
    this.packumentCache = this.opts.packumentCache || null

    // handle case when npm-package-arg guesses wrong.
    if (this.spec.type === 'tag' &&
        this.spec.rawSpec === '' &&
        this.defaultTag !== 'latest') {
      this.spec = npa(`${this.spec.name}@${this.defaultTag}`)
    }
    this.registry = fetch.pickRegistry(spec, opts)
    this.packumentUrl = removeTrailingSlashes(this.registry) + '/' +
      this.spec.escapedName

    // XXX pacote <=9 has some logic to ignore opts.resolved if
    // the resolved URL doesn't go to the same registry.
    // Consider reproducing that here, to throw away this.resolved
    // in that case.
  }

  resolve () {
    if (this.resolved) {
      return Promise.resolve(this.resolved)
    }

    // fetching the manifest sets resolved and (usually) integrity
    return this.manifest().then(() => {
      if (this.resolved) {
        return this.resolved
      }

      throw Object.assign(
        new Error('Invalid package manifest: no `dist.tarball` field'),
        { package: this.spec.toString() }
      )
    })
  }

  [_headers] () {
    return {
      // npm will override UA, but ensure that we always send *something*
      'user-agent': this.opts.userAgent ||
        `pacote/${pacoteVersion} node/${process.version}`,
      ...(this.opts.headers || {}),
      'pacote-version': pacoteVersion,
      'pacote-req-type': 'packument',
      'pacote-pkg-id': `registry:${this.spec.name}`,
      accept: this.fullMetadata ? fullDoc : corgiDoc,
    }
  }

  async packument () {
    // note this might be either an in-flight promise for a request,
    // or the actual packument, but we never want to make more than
    // one request at a time for the same thing regardless.
    if (this.packumentCache && this.packumentCache.has(this.packumentUrl)) {
      return this.packumentCache.get(this.packumentUrl)
    }

    // npm-registry-fetch the packument
    // set the appropriate header for corgis if fullMetadata isn't set
    // return the res.json() promise
    const p = fetch(this.packumentUrl, {
      ...this.opts,
      headers: this[_headers](),
      spec: this.spec,
      // never check integrity for packuments themselves
      integrity: null,
    }).then(res => res.json().then(packument => {
      packument._cached = res.headers.has('x-local-cache')
      packument._contentLength = +res.headers.get('content-length')
      if (this.packumentCache) {
        this.packumentCache.set(this.packumentUrl, packument)
      }
      return packument
    })).catch(er => {
      if (this.packumentCache) {
        this.packumentCache.delete(this.packumentUrl)
      }
      if (er.code === 'E404' && !this.fullMetadata) {
        // possible that corgis are not supported by this registry
        this.fullMetadata = true
        return this.packument()
      }
      throw er
    })
    if (this.packumentCache) {
      this.packumentCache.set(this.packumentUrl, p)
    }
    return p
  }

  manifest () {
    if (this.package) {
      return Promise.resolve(this.package)
    }

    return this.packument()
      .then(packument => pickManifest(packument, this.spec.fetchSpec, {
        ...this.opts,
        defaultTag: this.defaultTag,
        before: this.before,
      }) /* XXX add ETARGET and E403 revalidation of cached packuments here */)
      .then(mani => {
        // add _resolved and _integrity from dist object
        const { dist } = mani
        if (dist) {
          this.resolved = mani._resolved = dist.tarball
          mani._from = this.from
          const distIntegrity = dist.integrity ? ssri.parse(dist.integrity)
            : dist.shasum ? ssri.fromHex(dist.shasum, 'sha1', { ...this.opts })
            : null
          if (distIntegrity) {
            if (!this.integrity) {
              this.integrity = distIntegrity
            } else if (!this.integrity.match(distIntegrity)) {
              // only bork if they have algos in common.
              // otherwise we end up breaking if we have saved a sha512
              // previously for the tarball, but the manifest only
              // provides a sha1, which is possible for older publishes.
              // Otherwise, this is almost certainly a case of holding it
              // wrong, and will result in weird or insecure behavior
              // later on when building package tree.
              for (const algo of Object.keys(this.integrity)) {
                if (distIntegrity[algo]) {
                  throw Object.assign(new Error(
                    `Integrity checksum failed when using ${algo}: ` +
                    `wanted ${this.integrity} but got ${distIntegrity}.`
                  ), { code: 'EINTEGRITY' })
                }
              }
              // made it this far, the integrity is worthwhile.  accept it.
              // the setter here will take care of merging it into what we
              // already had.
              this.integrity = distIntegrity
            }
          }
        }
        if (this.integrity) {
          mani._integrity = String(this.integrity)
        }
        this.package = rpj.normalize(mani)
        return this.package
      })
  }

  [_tarballFromResolved] () {
    // we use a RemoteFetcher to get the actual tarball stream
    return new RemoteFetcher(this.resolved, {
      ...this.opts,
      resolved: this.resolved,
      pkgid: `registry:${this.spec.name}@${this.resolved}`,
    })[_tarballFromResolved]()
  }

  get types () {
    return [
      'tag',
      'version',
      'range',
    ]
  }
}
module.exports = RegistryFetcher

}, function(modId) { var map = {"./fetcher.js":1653046642318,"./remote.js":1653046642324,"../package.json":1653046642325,"./util/trailing-slashes.js":1653046642320}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642317);
})()
//miniprogram-npm-outsideDeps=["npm-package-arg","ssri","util","path","rimraf","tar","proc-log","promise-retry","fs-minipass","cacache","@npmcli/installed-package-contents","read-package-json-fast","read-package-json","chownr","infer-owner","mkdirp","os","@npmcli/git","npm-pick-manifest","minipass","fs","npm-registry-fetch","npm-packlist","@npmcli/run-script","@npmcli/promise-spawn"]
//# sourceMappingURL=index.js.map