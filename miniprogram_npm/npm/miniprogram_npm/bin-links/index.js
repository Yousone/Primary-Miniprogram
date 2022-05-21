module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642011, function(require, module, exports) {
const linkBins = require('./link-bins.js')
const linkMans = require('./link-mans.js')

const binLinks = opts => {
  const { path, pkg, force, global, top } = opts
  // global top pkgs on windows get bins installed in {prefix}, and no mans
  //
  // unix global top pkgs get their bins installed in {prefix}/bin,
  // and mans in {prefix}/share/man
  //
  // non-top pkgs get their bins installed in {prefix}/node_modules/.bin,
  // and do not install mans
  //
  // non-global top pkgs don't have any bins or mans linked.  From here on
  // out, if it's top, we know that it's global, so no need to pass that
  // option further down the stack.
  if (top && !global) {
    return Promise.resolve()
  }

  return Promise.all([
    // allow clobbering within the local node_modules/.bin folder.
    // only global bins are protected in this way, or else it is
    // yet another vector for excessive dependency conflicts.
    linkBins({ path, pkg, top, force: force || !top }),
    linkMans({ path, pkg, top, force }),
  ])
}

const shimBin = require('./shim-bin.js')
const linkGently = require('./link-gently.js')
const resetSeen = () => {
  shimBin.resetSeen()
  linkGently.resetSeen()
}

const checkBins = require('./check-bins.js')
const getPaths = require('./get-paths.js')

module.exports = Object.assign(binLinks, {
  checkBins,
  resetSeen,
  getPaths,
})

}, function(modId) {var map = {"./link-bins.js":1653046642012,"./link-mans.js":1653046642021,"./shim-bin.js":1653046642017,"./link-gently.js":1653046642020,"./check-bins.js":1653046642023,"./get-paths.js":1653046642025}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642012, function(require, module, exports) {
const isWindows = require('./is-windows.js')
const binTarget = require('./bin-target.js')
const { dirname, resolve, relative } = require('path')
const linkBin = isWindows ? require('./shim-bin.js') : require('./link-bin.js')
const normalize = require('npm-normalize-package-bin')

const linkBins = ({ path, pkg, top, force }) => {
  pkg = normalize(pkg)
  if (!pkg.bin) {
    return Promise.resolve([])
  }
  const promises = []
  const target = binTarget({ path, top })
  for (const [key, val] of Object.entries(pkg.bin)) {
    const to = resolve(target, key)
    const absFrom = resolve(path, val)
    const from = relative(dirname(to), absFrom)
    promises.push(linkBin({ path, from, to, absFrom, force }))
  }
  return Promise.all(promises)
}

module.exports = linkBins

}, function(modId) { var map = {"./is-windows.js":1653046642013,"./bin-target.js":1653046642014,"./shim-bin.js":1653046642017,"./link-bin.js":1653046642019}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642013, function(require, module, exports) {
const platform = process.env.__TESTING_BIN_LINKS_PLATFORM__ || process.platform
module.exports = platform === 'win32'

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642014, function(require, module, exports) {
const isWindows = require('./is-windows.js')
const getPrefix = require('./get-prefix.js')
const getNodeModules = require('./get-node-modules.js')
const { dirname } = require('path')

module.exports = ({ top, path }) =>
  !top ? getNodeModules(path) + '/.bin'
  : isWindows ? getPrefix(path)
  : dirname(getPrefix(path)) + '/bin'

}, function(modId) { var map = {"./is-windows.js":1653046642013,"./get-prefix.js":1653046642015,"./get-node-modules.js":1653046642016}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642015, function(require, module, exports) {
const { dirname } = require('path')
const getNodeModules = require('./get-node-modules.js')
module.exports = path => dirname(getNodeModules(path))

}, function(modId) { var map = {"./get-node-modules.js":1653046642016}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642016, function(require, module, exports) {
// we know it's global and/or not top, so the path has to be
// {prefix}/node_modules/{name}.  Can't rely on pkg.name, because
// it might be installed as an alias.

const { dirname, basename } = require('path')
// this gets called a lot and can't change, so memoize it
const memo = new Map()
module.exports = path => {
  if (memo.has(path)) {
    return memo.get(path)
  }

  const scopeOrNm = dirname(path)
  const nm = basename(scopeOrNm) === 'node_modules' ? scopeOrNm
    : dirname(scopeOrNm)

  memo.set(path, nm)
  return nm
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642017, function(require, module, exports) {
const { promisify } = require('util')
const { resolve, dirname } = require('path')
const fs = require('fs')
const lstat = promisify(fs.lstat)
const throwNonEnoent = er => {
  if (er.code !== 'ENOENT') {
    throw er
  }
}

const cmdShim = require('cmd-shim')
const readCmdShim = require('read-cmd-shim')

const fixBin = require('./fix-bin.js')

// even in --force mode, we never create a shim over a shim we've
// already created.  you can have multiple packages in a tree trying
// to contend for the same bin, which creates a race condition and
// nondeterminism.
const seen = new Set()

const failEEXIST = ({ path, to, from }) =>
  Promise.reject(Object.assign(new Error('EEXIST: file already exists'), {
    path: to,
    dest: from,
    code: 'EEXIST',
  }))

const handleReadCmdShimError = ({ er, from, to }) =>
  er.code === 'ENOENT' ? null
  : er.code === 'ENOTASHIM' ? failEEXIST({ from, to })
  : Promise.reject(er)

const SKIP = Symbol('skip - missing or already installed')
const shimBin = ({ path, to, from, absFrom, force }) => {
  const shims = [
    to,
    to + '.cmd',
    to + '.ps1',
  ]

  for (const shim of shims) {
    if (seen.has(shim)) {
      return true
    }
    seen.add(shim)
  }

  return Promise.all([
    ...shims,
    absFrom,
  ].map(f => lstat(f).catch(throwNonEnoent))).then((stats) => {
    const [, , , stFrom] = stats
    if (!stFrom) {
      return SKIP
    }

    if (force) {
      return
    }

    return Promise.all(shims.map((s, i) => [s, stats[i]]).map(([s, st]) => {
      if (!st) {
        return
      }
      return readCmdShim(s)
        .then(target => {
          target = resolve(dirname(to), target)
          if (target.indexOf(resolve(path)) !== 0) {
            return failEEXIST({ from, to, path })
          }
        }, er => handleReadCmdShimError({ er, from, to }))
    }))
  })
    .then(skip => skip !== SKIP && doShim(absFrom, to))
}

const doShim = (absFrom, to) =>
  cmdShim(absFrom, to).then(() => fixBin(absFrom))

const resetSeen = () => {
  for (const p of seen) {
    seen.delete(p)
  }
}

module.exports = Object.assign(shimBin, { resetSeen })

}, function(modId) { var map = {"./fix-bin.js":1653046642018}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642018, function(require, module, exports) {
// make sure that bins are executable, and that they don't have
// windows line-endings on the hashbang line.
const fs = require('fs')
const { promisify } = require('util')

const execMode = 0o777 & (~process.umask())

const writeFileAtomic = require('write-file-atomic')
const open = promisify(fs.open)
const close = promisify(fs.close)
const read = promisify(fs.read)
const chmod = promisify(fs.chmod)
const readFile = promisify(fs.readFile)

const isWindowsHashBang = buf =>
  buf[0] === '#'.charCodeAt(0) &&
  buf[1] === '!'.charCodeAt(0) &&
  /^#![^\n]+\r\n/.test(buf.toString())

const isWindowsHashbangFile = file => {
  const FALSE = () => false
  return open(file, 'r').then(fd => {
    const buf = Buffer.alloc(2048)
    return read(fd, buf, 0, 2048, 0)
      .then(
        () => {
          const isWHB = isWindowsHashBang(buf)
          return close(fd).then(() => isWHB, () => isWHB)
        },
        // don't leak FD if read() fails
        () => close(fd).then(FALSE, FALSE)
      )
  }, FALSE)
}

const dos2Unix = file =>
  readFile(file, 'utf8').then(content =>
    writeFileAtomic(file, content.replace(/^(#![^\n]+)\r\n/, '$1\n')))

const fixBin = (file, mode = execMode) => chmod(file, mode)
  .then(() => isWindowsHashbangFile(file))
  .then(isWHB => isWHB ? dos2Unix(file) : null)

module.exports = fixBin

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642019, function(require, module, exports) {
const linkGently = require('./link-gently.js')
const fixBin = require('./fix-bin.js')

// linking bins is simple.  just symlink, and if we linked it, fix the bin up
const linkBin = ({ path, to, from, absFrom, force }) =>
  linkGently({ path, to, from, absFrom, force })
    .then(linked => linked && fixBin(absFrom))

module.exports = linkBin

}, function(modId) { var map = {"./link-gently.js":1653046642020,"./fix-bin.js":1653046642018}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642020, function(require, module, exports) {
// if the thing isn't there, skip it
// if there's a non-symlink there already, eexist
// if there's a symlink already, pointing somewhere else, eexist
// if there's a symlink already, pointing into our pkg, remove it first
// then create the symlink

const { promisify } = require('util')
const { resolve, dirname } = require('path')
const mkdirp = require('mkdirp-infer-owner')
const fs = require('fs')
const symlink = promisify(fs.symlink)
const readlink = promisify(fs.readlink)
const lstat = promisify(fs.lstat)
const throwNonEnoent = er => {
  if (er.code !== 'ENOENT') {
    throw er
  }
}

// even in --force mode, we never create a link over a link we've
// already created.  you can have multiple packages in a tree trying
// to contend for the same bin, or the same manpage listed multiple times,
// which creates a race condition and nondeterminism.
const seen = new Set()

// disable glob in our rimraf calls
const rimraf = promisify(require('rimraf'))
const rm = path => rimraf(path, { glob: false })

const SKIP = Symbol('skip - missing or already installed')
const CLOBBER = Symbol('clobber - ours or in forceful mode')

const linkGently = async ({ path, to, from, absFrom, force }) => {
  if (seen.has(to)) {
    return true
  }
  seen.add(to)

  // if the script or manpage isn't there, just ignore it.
  // this arguably *should* be an install error of some sort,
  // or at least a warning, but npm has always behaved this
  // way in the past, so it'd be a breaking change
  return Promise.all([
    lstat(absFrom).catch(throwNonEnoent),
    lstat(to).catch(throwNonEnoent),
  ]).then(([stFrom, stTo]) => {
    // not present in package, skip it
    if (!stFrom) {
      return SKIP
    }

    // exists! maybe clobber if we can
    if (stTo) {
      if (!stTo.isSymbolicLink()) {
        return force && rm(to).then(() => CLOBBER)
      }

      return readlink(to).then(target => {
        if (target === from) {
          return SKIP
        } // skip it, already set up like we want it.

        target = resolve(dirname(to), target)
        if (target.indexOf(path) === 0 || force) {
          return rm(to).then(() => CLOBBER)
        }
      })
    } else {
      // doesn't exist, dir might not either
      return mkdirp(dirname(to))
    }
  })
    .then(skipOrClobber => {
      if (skipOrClobber === SKIP) {
        return false
      }
      return symlink(from, to, 'file').catch(er => {
        if (skipOrClobber === CLOBBER || force) {
          return rm(to).then(() => symlink(from, to, 'file'))
        }
        throw er
      }).then(() => true)
    })
}

const resetSeen = () => {
  for (const p of seen) {
    seen.delete(p)
  }
}

module.exports = Object.assign(linkGently, { resetSeen })

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642021, function(require, module, exports) {
const { dirname, relative, join, resolve, basename } = require('path')
const linkGently = require('./link-gently.js')
const manTarget = require('./man-target.js')

const linkMans = ({ path, pkg, top, force }) => {
  const target = manTarget({ path, top })
  if (!target || !pkg.man || !Array.isArray(pkg.man) || !pkg.man.length) {
    return Promise.resolve([])
  }

  // break any links to c:\\blah or /foo/blah or ../blah
  // and filter out duplicates
  const set = [...new Set(pkg.man.map(man =>
    man ? join('/', man).replace(/\\|:/g, '/').substr(1) : null)
    .filter(man => typeof man === 'string'))]

  return Promise.all(set.map(man => {
    const parseMan = man.match(/(.*\.([0-9]+)(\.gz)?)$/)
    if (!parseMan) {
      return Promise.reject(Object.assign(new Error('invalid man entry name\n' +
        'Man files must end with a number, ' +
        'and optionally a .gz suffix if they are compressed.'
      ), {
        code: 'EBADMAN',
        path,
        pkgid: pkg._id,
        man,
      }))
    }

    const stem = parseMan[1]
    const sxn = parseMan[2]
    const base = basename(stem)
    const absFrom = resolve(path, man)
    /* istanbul ignore if - that unpossible */
    if (absFrom.indexOf(path) !== 0) {
      return Promise.reject(Object.assign(new Error('invalid man entry'), {
        code: 'EBADMAN',
        path,
        pkgid: pkg._id,
        man,
      }))
    }

    const to = resolve(target, 'man' + sxn, base)
    const from = relative(dirname(to), absFrom)

    return linkGently({ from, to, path, absFrom, force })
  }))
}

module.exports = linkMans

}, function(modId) { var map = {"./link-gently.js":1653046642020,"./man-target.js":1653046642022}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642022, function(require, module, exports) {
const isWindows = require('./is-windows.js')
const getPrefix = require('./get-prefix.js')
const { dirname } = require('path')

module.exports = ({ top, path }) => !top || isWindows ? null
  : dirname(getPrefix(path)) + '/share/man'

}, function(modId) { var map = {"./is-windows.js":1653046642013,"./get-prefix.js":1653046642015}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642023, function(require, module, exports) {
const checkBin = require('./check-bin.js')
const normalize = require('npm-normalize-package-bin')
const checkBins = async ({ pkg, path, top, global, force }) => {
  // always ok to clobber when forced
  // always ok to clobber local bins, or when forced
  if (force || !global || !top) {
    return
  }

  pkg = normalize(pkg)
  if (!pkg.bin) {
    return
  }

  await Promise.all(Object.keys(pkg.bin)
    .map(bin => checkBin({ bin, path, top, global, force })))
}
module.exports = checkBins

}, function(modId) { var map = {"./check-bin.js":1653046642024}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642024, function(require, module, exports) {
// check to see if a bin is allowed to be overwritten
// either rejects or resolves to nothing.  return value not relevant.
const isWindows = require('./is-windows.js')
const binTarget = require('./bin-target.js')
const { resolve, dirname } = require('path')
const readCmdShim = require('read-cmd-shim')
const fs = require('fs')
const { promisify } = require('util')
const readlink = promisify(fs.readlink)

const checkBin = async ({ bin, path, top, global, force }) => {
  // always ok to clobber when forced
  // always ok to clobber local bins, or when forced
  if (force || !global || !top) {
    return
  }

  // ok, need to make sure, then
  const target = resolve(binTarget({ path, top }), bin)
  path = resolve(path)
  return isWindows ? checkShim({ target, path }) : checkLink({ target, path })
}

// only enoent is allowed.  anything else is a problem.
const handleReadLinkError = async ({ er, target }) =>
  er.code === 'ENOENT' ? null
  : failEEXIST({ target })

const checkLink = async ({ target, path }) => {
  const current = await readlink(target)
    .catch(er => handleReadLinkError({ er, target }))

  if (!current) {
    return
  }

  const resolved = resolve(dirname(target), current)

  if (resolved.toLowerCase().indexOf(path.toLowerCase()) !== 0) {
    return failEEXIST({ target })
  }
}

const handleReadCmdShimError = ({ er, target }) =>
  er.code === 'ENOENT' ? null
  : failEEXIST({ target })

const failEEXIST = ({ target }) =>
  Promise.reject(Object.assign(new Error('EEXIST: file already exists'), {
    path: target,
    code: 'EEXIST',
  }))

const checkShim = async ({ target, path }) => {
  const shims = [
    target,
    target + '.cmd',
    target + '.ps1',
  ]
  await Promise.all(shims.map(async target => {
    const current = await readCmdShim(target)
      .catch(er => handleReadCmdShimError({ er, target }))

    if (!current) {
      return
    }

    const resolved = resolve(dirname(target), current.replace(/\\/g, '/'))

    if (resolved.toLowerCase().indexOf(path.toLowerCase()) !== 0) {
      return failEEXIST({ target })
    }
  }))
}

module.exports = checkBin

}, function(modId) { var map = {"./is-windows.js":1653046642013,"./bin-target.js":1653046642014}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642025, function(require, module, exports) {
// get all the paths that are (or might be) installed for a given pkg
// There's no guarantee that all of these will be installed, but if they
// are present, then we can assume that they're associated.
const binTarget = require('./bin-target.js')
const manTarget = require('./man-target.js')
const { resolve, basename } = require('path')
const isWindows = require('./is-windows.js')
module.exports = ({ path, pkg, global, top }) => {
  if (top && !global) {
    return []
  }

  const binSet = []
  const binTarg = binTarget({ path, top })
  if (pkg.bin) {
    for (const bin of Object.keys(pkg.bin)) {
      const b = resolve(binTarg, bin)
      binSet.push(b)
      if (isWindows) {
        binSet.push(b + '.cmd')
        binSet.push(b + '.ps1')
      }
    }
  }

  const manTarg = manTarget({ path, top })
  const manSet = []
  if (manTarg && pkg.man && Array.isArray(pkg.man) && pkg.man.length) {
    for (const man of pkg.man) {
      const parseMan = man.match(/(.*\.([0-9]+)(\.gz)?)$/)
      // invalid entries invalidate the entire man set
      if (!parseMan) {
        return binSet
      }

      const stem = parseMan[1]
      const sxn = parseMan[2]
      const base = basename(stem)
      const absFrom = resolve(path, man)

      /* istanbul ignore if - should be impossible */
      if (absFrom.indexOf(path) !== 0) {
        return binSet
      }

      manSet.push(resolve(manTarg, 'man' + sxn, base))
    }
  }

  return manSet.length ? [...binSet, ...manSet] : binSet
}

}, function(modId) { var map = {"./bin-target.js":1653046642014,"./man-target.js":1653046642022,"./is-windows.js":1653046642013}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642011);
})()
//miniprogram-npm-outsideDeps=["path","npm-normalize-package-bin","util","fs","cmd-shim","read-cmd-shim","write-file-atomic","mkdirp-infer-owner","rimraf"]
//# sourceMappingURL=index.js.map