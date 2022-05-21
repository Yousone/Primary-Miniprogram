module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046641979, function(require, module, exports) {
const rpj = require('read-package-json-fast')
const runScriptPkg = require('./run-script-pkg.js')
const validateOptions = require('./validate-options.js')
const isServerPackage = require('./is-server-package.js')

const runScript = options => {
  validateOptions(options)
  const { pkg, path } = options
  return pkg ? runScriptPkg(options)
    : rpj(path + '/package.json').then(pkg => runScriptPkg({ ...options, pkg }))
}

module.exports = Object.assign(runScript, { isServerPackage })

}, function(modId) {var map = {"./run-script-pkg.js":1653046641980,"./validate-options.js":1653046641987,"./is-server-package.js":1653046641986}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641980, function(require, module, exports) {
const makeSpawnArgs = require('./make-spawn-args.js')
const promiseSpawn = require('@npmcli/promise-spawn')
const packageEnvs = require('./package-envs.js')
const { isNodeGypPackage, defaultGypInstallScript } = require('@npmcli/node-gyp')
const signalManager = require('./signal-manager.js')
const isServerPackage = require('./is-server-package.js')

// you wouldn't like me when I'm angry...
const bruce = (id, event, cmd) =>
  `\n> ${id ? id + ' ' : ''}${event}\n> ${cmd.trim().replace(/\n/g, '\n> ')}\n`

const runScriptPkg = async options => {
  const {
    event,
    path,
    scriptShell,
    env = {},
    stdio = 'pipe',
    pkg,
    args = [],
    stdioString = false,
    // note: only used when stdio:inherit
    banner = true,
    // how long to wait for a process.kill signal
    // only exposed here so that we can make the test go a bit faster.
    signalTimeout = 500,
  } = options

  const { scripts = {}, gypfile } = pkg
  let cmd = null
  if (options.cmd) {
    cmd = options.cmd
  } else if (pkg.scripts && pkg.scripts[event]) {
    cmd = pkg.scripts[event] + args.map(a => ` ${JSON.stringify(a)}`).join('')
  } else if (
    // If there is no preinstall or install script, default to rebuilding node-gyp packages.
    event === 'install' &&
    !scripts.install &&
    !scripts.preinstall &&
    gypfile !== false &&
    await isNodeGypPackage(path)
  ) {
    cmd = defaultGypInstallScript
  } else if (event === 'start' && await isServerPackage(path)) {
    cmd = 'node server.js' + args.map(a => ` ${JSON.stringify(a)}`).join('')
  }

  if (!cmd) {
    return { code: 0, signal: null }
  }

  if (stdio === 'inherit' && banner !== false) {
    // we're dumping to the parent's stdout, so print the banner
    console.log(bruce(pkg._id, event, cmd))
  }

  const p = promiseSpawn(...makeSpawnArgs({
    event,
    path,
    scriptShell,
    env: packageEnvs(env, pkg),
    stdio,
    cmd,
    stdioString,
  }), {
    event,
    script: cmd,
    pkgid: pkg._id,
    path,
  })

  if (stdio === 'inherit') {
    signalManager.add(p.process)
  }

  if (p.stdin) {
    p.stdin.end()
  }

  return p.catch(er => {
    const { signal } = er
    if (stdio === 'inherit' && signal) {
      process.kill(process.pid, signal)
      // just in case we don't die, reject after 500ms
      // this also keeps the node process open long enough to actually
      // get the signal, rather than terminating gracefully.
      return new Promise((res, rej) => setTimeout(() => rej(er), signalTimeout))
    } else {
      throw er
    }
  })
}

module.exports = runScriptPkg

}, function(modId) { var map = {"./make-spawn-args.js":1653046641981,"./package-envs.js":1653046641984,"./signal-manager.js":1653046641985,"./is-server-package.js":1653046641986}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641981, function(require, module, exports) {
/* eslint camelcase: "off" */
const isWindows = require('./is-windows.js')
const setPATH = require('./set-path.js')
const { resolve } = require('path')
const npm_config_node_gyp = require.resolve('node-gyp/bin/node-gyp.js')

const makeSpawnArgs = options => {
  const {
    event,
    path,
    scriptShell = isWindows ? process.env.ComSpec || 'cmd' : 'sh',
    env = {},
    stdio,
    cmd,
    stdioString = false,
  } = options

  const isCmd = /(?:^|\\)cmd(?:\.exe)?$/i.test(scriptShell)
  const args = isCmd ? ['/d', '/s', '/c', cmd] : ['-c', cmd]

  const spawnOpts = {
    env: setPATH(path, {
      // we need to at least save the PATH environment var
      ...process.env,
      ...env,
      npm_package_json: resolve(path, 'package.json'),
      npm_lifecycle_event: event,
      npm_lifecycle_script: cmd,
      npm_config_node_gyp,
    }),
    stdioString,
    stdio,
    cwd: path,
    ...(isCmd ? { windowsVerbatimArguments: true } : {}),
  }

  return [scriptShell, args, spawnOpts]
}

module.exports = makeSpawnArgs

}, function(modId) { var map = {"./is-windows.js":1653046641982,"./set-path.js":1653046641983}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641982, function(require, module, exports) {
const platform = process.env.__FAKE_TESTING_PLATFORM__ || process.platform
module.exports = platform === 'win32'

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641983, function(require, module, exports) {
const { resolve, dirname } = require('path')
const isWindows = require('./is-windows.js')
// the path here is relative, even though it does not need to be
// in order to make the posix tests pass in windows
const nodeGypPath = resolve(__dirname, '../lib/node-gyp-bin')

// Windows typically calls its PATH environ 'Path', but this is not
// guaranteed, nor is it guaranteed to be the only one.  Merge them
// all together in the order they appear in the object.
const setPATH = (projectPath, env) => {
  // not require('path').delimiter, because we fake this for testing
  const delimiter = isWindows ? ';' : ':'
  const PATH = Object.keys(env).filter(p => /^path$/i.test(p) && env[p])
    .map(p => env[p].split(delimiter))
    .reduce((set, p) => set.concat(p.filter(p => !set.includes(p))), [])
    .join(delimiter)

  const pathArr = []
  // unshift the ./node_modules/.bin from every folder
  // walk up until dirname() does nothing, at the root
  // XXX should we specify a cwd that we don't go above?
  let p = projectPath
  let pp
  do {
    pathArr.push(resolve(p, 'node_modules', '.bin'))
    pp = p
    p = dirname(p)
  } while (p !== pp)
  pathArr.push(nodeGypPath, PATH)

  const pathVal = pathArr.join(delimiter)

  // XXX include the node-gyp-bin path somehow?  Probably better for
  // npm or arborist or whoever to just provide that by putting it in
  // the PATH environ, since that's preserved anyway.
  for (const key of Object.keys(env)) {
    if (/^path$/i.test(key)) {
      env[key] = pathVal
    }
  }

  return env
}

module.exports = setPATH

}, function(modId) { var map = {"./is-windows.js":1653046641982}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641984, function(require, module, exports) {
// https://github.com/npm/rfcs/pull/183

const envVal = val => Array.isArray(val) ? val.map(v => envVal(v)).join('\n\n')
  : val === null || val === false ? ''
  : String(val)

const packageEnvs = (env, vals, prefix) => {
  for (const [key, val] of Object.entries(vals)) {
    if (val === undefined) {
      continue
    } else if (val && !Array.isArray(val) && typeof val === 'object') {
      packageEnvs(env, val, `${prefix}${key}_`)
    } else {
      env[`${prefix}${key}`] = envVal(val)
    }
  }
  return env
}

module.exports = (env, pkg) => packageEnvs({ ...env }, {
  name: pkg.name,
  version: pkg.version,
  config: pkg.config,
  engines: pkg.engines,
  bin: pkg.bin,
}, 'npm_package_')

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641985, function(require, module, exports) {
const runningProcs = new Set()
let handlersInstalled = false

const forwardedSignals = [
  'SIGINT',
  'SIGTERM',
]

const handleSignal = signal => {
  for (const proc of runningProcs) {
    proc.kill(signal)
  }
}

const setupListeners = () => {
  for (const signal of forwardedSignals) {
    process.on(signal, handleSignal)
  }
  handlersInstalled = true
}

const cleanupListeners = () => {
  if (runningProcs.size === 0) {
    for (const signal of forwardedSignals) {
      process.removeListener(signal, handleSignal)
    }
    handlersInstalled = false
  }
}

const add = proc => {
  runningProcs.add(proc)
  if (!handlersInstalled) {
    setupListeners()
  }

  proc.once('exit', () => {
    runningProcs.delete(proc)
    cleanupListeners()
  })
}

module.exports = {
  add,
  handleSignal,
  forwardedSignals,
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641986, function(require, module, exports) {
const util = require('util')
const fs = require('fs')
const { stat } = fs.promises || { stat: util.promisify(fs.stat) }
const { resolve } = require('path')
module.exports = async path => {
  try {
    const st = await stat(resolve(path, 'server.js'))
    return st.isFile()
  } catch (er) {
    return false
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641987, function(require, module, exports) {
const validateOptions = options => {
  if (typeof options !== 'object' || !options) {
    throw new TypeError('invalid options object provided to runScript')
  }

  const {
    event,
    path,
    scriptShell,
    env = {},
    stdio = 'pipe',
    args = [],
    cmd,
  } = options

  if (!event || typeof event !== 'string') {
    throw new TypeError('valid event not provided to runScript')
  }
  if (!path || typeof path !== 'string') {
    throw new TypeError('valid path not provided to runScript')
  }
  if (scriptShell !== undefined && typeof scriptShell !== 'string') {
    throw new TypeError('invalid scriptShell option provided to runScript')
  }
  if (typeof env !== 'object' || !env) {
    throw new TypeError('invalid env option provided to runScript')
  }
  if (typeof stdio !== 'string' && !Array.isArray(stdio)) {
    throw new TypeError('invalid stdio option provided to runScript')
  }
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
    throw new TypeError('invalid args option provided to runScript')
  }
  if (cmd !== undefined && typeof cmd !== 'string') {
    throw new TypeError('invalid cmd option provided to runScript')
  }
}

module.exports = validateOptions

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046641979);
})()
//miniprogram-npm-outsideDeps=["read-package-json-fast","@npmcli/promise-spawn","@npmcli/node-gyp","path","util","fs"]
//# sourceMappingURL=index.js.map