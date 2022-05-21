module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642212, function(require, module, exports) {
const { delimiter, dirname, resolve } = require('path')
const { promisify } = require('util')
const read = promisify(require('read'))

const Arborist = require('@npmcli/arborist')
const ciDetect = require('@npmcli/ci-detect')
const log = require('proc-log')
const npmlog = require('npmlog')
const mkdirp = require('mkdirp-infer-owner')
const npa = require('npm-package-arg')
const pacote = require('pacote')
const readPackageJson = require('read-package-json-fast')

const cacheInstallDir = require('./cache-install-dir.js')
const { fileExists, localFileExists } = require('./file-exists.js')
const getBinFromManifest = require('./get-bin-from-manifest.js')
const manifestMissing = require('./manifest-missing.js')
const noTTY = require('./no-tty.js')
const runScript = require('./run-script.js')
const isWindows = require('./is-windows.js')

/* istanbul ignore next */
const PATH = (
  process.env.PATH || process.env.Path || process.env.path
).split(delimiter)

const exec = async (opts) => {
  const {
    args = [],
    call = '',
    color = false,
    localBin = resolve('./node_modules/.bin'),
    locationMsg = undefined,
    globalBin = '',
    output,
    packages: _packages = [],
    path = '.',
    runPath = '.',
    scriptShell = isWindows ? process.env.ComSpec || 'cmd' : 'sh',
    yes = undefined,
    ...flatOptions
  } = opts

  // dereferences values because we manipulate it later
  const packages = [..._packages]
  const pathArr = [...PATH]
  const _run = () => runScript({
    args,
    call,
    color,
    flatOptions,
    locationMsg,
    output,
    path,
    pathArr,
    runPath,
    scriptShell,
  })

  // nothing to maybe install, skip the arborist dance
  if (!call && !args.length && !packages.length) {
    return await _run()
  }

  const needPackageCommandSwap = args.length && !packages.length
  // if there's an argument and no package has been explicitly asked for
  // check the local and global bin paths for a binary named the same as
  // the argument and run it if it exists, otherwise fall through to
  // the behavior of treating the single argument as a package name
  if (needPackageCommandSwap) {
    let binExists = false
    const dir = dirname(dirname(localBin))
    const localBinPath = await localFileExists(dir, args[0])
    if (localBinPath) {
      pathArr.unshift(localBinPath)
      binExists = true
    } else if (await fileExists(`${globalBin}/${args[0]}`)) {
      pathArr.unshift(globalBin)
      binExists = true
    }

    if (binExists) {
      return await _run()
    }

    packages.push(args[0])
  }

  // If we do `npm exec foo`, and have a `foo` locally, then we'll
  // always use that, so we don't really need to fetch the manifest.
  // So: run npa on each packages entry, and if it is a name with a
  // rawSpec==='', then try to readPackageJson at
  // node_modules/${name}/package.json, and only pacote fetch if
  // that fails.
  const manis = await Promise.all(packages.map(async p => {
    const spec = npa(p, path)
    if (spec.type === 'tag' && spec.rawSpec === '') {
      // fall through to the pacote.manifest() approach
      try {
        const pj = resolve(path, 'node_modules', spec.name, 'package.json')
        return await readPackageJson(pj)
      } catch (er) {}
    }
    // Force preferOnline to true so we are making sure to pull in the latest
    // This is especially useful if the user didn't give us a version, and
    // they expect to be running @latest
    return await pacote.manifest(p, {
      ...flatOptions,
      preferOnline: true,
    })
  }))

  if (needPackageCommandSwap) {
    args[0] = getBinFromManifest(manis[0])
  }

  // figure out whether we need to install stuff, or if local is fine
  const localArb = new Arborist({
    ...flatOptions,
    path,
  })
  const tree = await localArb.loadActual()

  // do we have all the packages in manifest list?
  const needInstall =
    manis.some(manifest => manifestMissing({ tree, manifest }))

  if (needInstall) {
    const { npxCache } = flatOptions
    const installDir = cacheInstallDir({ npxCache, packages })
    await mkdirp(installDir)
    const arb = new Arborist({
      ...flatOptions,
      path: installDir,
    })
    const tree = await arb.loadActual()

    // at this point, we have to ensure that we get the exact same
    // version, because it's something that has only ever been installed
    // by npm exec in the cache install directory
    const add = manis.filter(mani => manifestMissing({
      tree,
      manifest: {
        ...mani,
        _from: `${mani.name}@${mani.version}`,
      },
    }))
      .map(mani => mani._from)
      .sort((a, b) => a.localeCompare(b, 'en'))

    // no need to install if already present
    if (add.length) {
      if (!yes) {
        // set -n to always say no
        if (yes === false) {
          throw new Error('canceled')
        }

        if (noTTY() || ciDetect()) {
          log.warn('exec', `The following package${
            add.length === 1 ? ' was' : 's were'
          } not found and will be installed: ${
            add.map((pkg) => pkg.replace(/@$/, '')).join(', ')
          }`)
        } else {
          const addList = add.map(a => `  ${a.replace(/@$/, '')}`)
            .join('\n') + '\n'
          const prompt = `Need to install the following packages:\n${
          addList
        }Ok to proceed? `
          npmlog.clearProgress()
          const confirm = await read({ prompt, default: 'y' })
          if (confirm.trim().toLowerCase().charAt(0) !== 'y') {
            throw new Error('canceled')
          }
        }
      }
      await arb.reify({
        ...flatOptions,
        add,
      })
    }
    pathArr.unshift(resolve(installDir, 'node_modules/.bin'))
  }

  return await _run()
}

module.exports = exec

}, function(modId) {var map = {"./cache-install-dir.js":1653046642213,"./file-exists.js":1653046642214,"./get-bin-from-manifest.js":1653046642215,"./manifest-missing.js":1653046642216,"./no-tty.js":1653046642217,"./run-script.js":1653046642218,"./is-windows.js":1653046642219}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642213, function(require, module, exports) {
const crypto = require('crypto')

const { resolve } = require('path')

const cacheInstallDir = ({ npxCache, packages }) => {
  if (!npxCache) {
    throw new Error('Must provide a valid npxCache path')
  }

  // only packages not found in ${prefix}/node_modules
  return resolve(npxCache, getHash(packages))
}

const getHash = (packages) =>
  crypto.createHash('sha512')
    .update(packages.sort((a, b) => a.localeCompare(b, 'en')).join('\n'))
    .digest('hex')
    .slice(0, 16)

module.exports = cacheInstallDir

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642214, function(require, module, exports) {
const { resolve } = require('path')
const { promisify } = require('util')
const stat = promisify(require('fs').stat)
const walkUp = require('walk-up-path')

const fileExists = (file) => stat(file)
  .then((stat) => stat.isFile())
  .catch(() => false)

const localFileExists = async (dir, binName, root = '/') => {
  root = resolve(root).toLowerCase()

  for (const path of walkUp(resolve(dir))) {
    const binDir = resolve(path, 'node_modules', '.bin')

    if (await fileExists(resolve(binDir, binName))) {
      return binDir
    }

    if (path.toLowerCase() === root) {
      return false
    }
  }

  return false
}

module.exports = {
  fileExists,
  localFileExists,
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642215, function(require, module, exports) {
const getBinFromManifest = (mani) => {
  // if we have a bin matching (unscoped portion of) packagename, use that
  // otherwise if there's 1 bin or all bin value is the same (alias), use
  // that, otherwise fail
  const bin = mani.bin || {}
  if (new Set(Object.values(bin)).size === 1) {
    return Object.keys(bin)[0]
  }

  // XXX probably a util to parse this better?
  const name = mani.name.replace(/^@[^/]+\//, '')
  if (bin[name]) {
    return name
  }

  // XXX need better error message
  throw Object.assign(new Error('could not determine executable to run'), {
    pkgid: mani._id,
  })
}

module.exports = getBinFromManifest

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642216, function(require, module, exports) {
const manifestMissing = ({ tree, manifest }) => {
  // if the tree doesn't have a child by that name/version, return true
  // true means we need to install it
  const child = tree.children.get(manifest.name)
  // if no child, we have to load it
  if (!child) {
    return true
  }

  // if no version/tag specified, allow whatever's there
  if (manifest._from === `${manifest.name}@`) {
    return false
  }

  // otherwise the version has to match what we WOULD get
  return child.version !== manifest.version
}

module.exports = manifestMissing

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642217, function(require, module, exports) {
module.exports = () => !process.stdin.isTTY

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642218, function(require, module, exports) {
const { delimiter } = require('path')

const chalk = require('chalk')
const ciDetect = require('@npmcli/ci-detect')
const runScript = require('@npmcli/run-script')
const readPackageJson = require('read-package-json-fast')
const npmlog = require('npmlog')
const log = require('proc-log')
const noTTY = require('./no-tty.js')

const nocolor = {
  reset: s => s,
  bold: s => s,
  dim: s => s,
}

const run = async ({
  args,
  call,
  color,
  flatOptions,
  locationMsg,
  output = () => {},
  path,
  pathArr,
  runPath,
  scriptShell,
}) => {
  // turn list of args into command string
  const script = call || args.shift() || scriptShell
  const colorize = color ? chalk : nocolor

  // do the fakey runScript dance
  // still should work if no package.json in cwd
  const realPkg = await readPackageJson(`${path}/package.json`)
    .catch(() => ({}))
  const pkg = {
    ...realPkg,
    scripts: {
      ...(realPkg.scripts || {}),
      npx: script,
    },
  }

  npmlog.disableProgress()

  try {
    if (script === scriptShell) {
      const isTTY = !noTTY()

      if (isTTY) {
        if (ciDetect()) {
          return log.warn('exec', 'Interactive mode disabled in CI environment')
        }

        locationMsg = locationMsg || ` at location:\n${colorize.dim(runPath)}`

        output(`${
          colorize.reset('\nEntering npm script environment')
        }${
          colorize.reset(locationMsg)
        }${
          colorize.bold('\nType \'exit\' or ^D when finished\n')
        }`)
      }
    }
    return await runScript({
      ...flatOptions,
      pkg,
      banner: false,
      // we always run in cwd, not --prefix
      path: runPath,
      stdioString: true,
      event: 'npx',
      args,
      env: {
        PATH: pathArr.join(delimiter),
      },
      stdio: 'inherit',
    })
  } finally {
    npmlog.enableProgress()
  }
}

module.exports = run

}, function(modId) { var map = {"./no-tty.js":1653046642217}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642219, function(require, module, exports) {
module.exports = process.platform === 'win32'

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642212);
})()
//miniprogram-npm-outsideDeps=["path","util","read","@npmcli/arborist","@npmcli/ci-detect","proc-log","npmlog","mkdirp-infer-owner","npm-package-arg","pacote","read-package-json-fast","crypto","fs","walk-up-path","chalk","@npmcli/run-script"]
//# sourceMappingURL=index.js.map