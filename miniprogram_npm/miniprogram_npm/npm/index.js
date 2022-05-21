module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046647753, function(require, module, exports) {
if (require.main === module) {
  require('./lib/cli.js')(process)
} else {
  throw new Error('The programmatic API was removed in npm v8.0.0')
}

}, function(modId) {var map = {"./lib/cli.js":1653046647754}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647754, function(require, module, exports) {
// Separated out for easier unit testing
module.exports = async process => {
  // set it here so that regardless of what happens later, we don't
  // leak any private CLI configs to other programs
  process.title = 'npm'

  // We used to differentiate between known broken and unsupported
  // versions of node and attempt to only log unsupported but still run.
  // After we dropped node 10 support, we can use new features
  // (like static, private, etc) which will only give vague syntax errors,
  // so now both broken and unsupported use console, but only broken
  // will process.exit. It is important to now perform *both* of these
  // checks as early as possible so the user gets the error message.
  const { checkForBrokenNode, checkForUnsupportedNode } = require('./utils/unsupported.js')
  checkForBrokenNode()
  checkForUnsupportedNode()

  const exitHandler = require('./utils/exit-handler.js')
  process.on('uncaughtException', exitHandler)
  process.on('unhandledRejection', exitHandler)

  const Npm = require('./npm.js')
  const npm = new Npm()
  exitHandler.setNpm(npm)

  // if npm is called as "npmg" or "npm_g", then
  // run in global mode.
  if (process.argv[1][process.argv[1].length - 1] === 'g') {
    process.argv.splice(1, 1, 'npm', '-g')
  }

  const log = require('./utils/log-shim.js')
  const replaceInfo = require('./utils/replace-info.js')
  log.verbose('cli', replaceInfo(process.argv))

  log.info('using', 'npm@%s', npm.version)
  log.info('using', 'node@%s', process.version)

  const updateNotifier = require('./utils/update-notifier.js')

  let cmd
  // now actually fire up npm and run the command.
  // this is how to use npm programmatically:
  try {
    await npm.load()
    if (npm.config.get('version', 'cli')) {
      npm.output(npm.version)
      return exitHandler()
    }

    // npm --versions=cli
    if (npm.config.get('versions', 'cli')) {
      npm.argv = ['version']
      npm.config.set('usage', false, 'cli')
    }

    updateNotifier(npm)

    cmd = npm.argv.shift()
    if (!cmd) {
      npm.output(await npm.usage)
      process.exitCode = 1
      return exitHandler()
    }

    await npm.exec(cmd, npm.argv)
    return exitHandler()
  } catch (err) {
    if (err.code === 'EUNKNOWNCOMMAND') {
      const didYouMean = require('./utils/did-you-mean.js')
      const suggestions = await didYouMean(npm, npm.localPrefix, cmd)
      npm.output(`Unknown command: "${cmd}"${suggestions}\n`)
      npm.output('To see a list of supported npm commands, run:\n  npm help')
      process.exitCode = 1
      return exitHandler()
    }
    return exitHandler(err)
  }
}

}, function(modId) { var map = {"./utils/unsupported.js":1653046647755,"./utils/exit-handler.js":1653046647757,"./utils/log-shim.js":1653046647758,"./utils/replace-info.js":1653046647761,"./utils/update-notifier.js":1653046647766,"./utils/did-you-mean.js":1653046647767}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647755, function(require, module, exports) {
/* eslint-disable no-console */
const semver = require('semver')
const supported = require('../../package.json').engines.node
const knownBroken = '<6.2.0 || 9 <9.3.0'

// Keep this file compatible with all practical versions of node
// so we dont get syntax errors when trying to give the users
// a nice error message. Don't use our log handler because
// if we encounter a syntax error early on, that will never
// get displayed to the user.

const checkVersion = exports.checkVersion = version => {
  const versionNoPrerelease = version.replace(/-.*$/, '')
  return {
    version: versionNoPrerelease,
    broken: semver.satisfies(versionNoPrerelease, knownBroken),
    unsupported: !semver.satisfies(versionNoPrerelease, supported),
  }
}

exports.checkForBrokenNode = () => {
  const nodejs = checkVersion(process.version)
  if (nodejs.broken) {
    console.error('ERROR: npm is known not to run on Node.js ' + process.version)
    console.error("You'll need to upgrade to a newer Node.js version in order to use this")
    console.error('version of npm. You can find the latest version at https://nodejs.org/')
    process.exit(1)
  }
}

exports.checkForUnsupportedNode = () => {
  const nodejs = checkVersion(process.version)
  if (nodejs.unsupported) {
    console.error('npm does not support Node.js ' + process.version)
    console.error('You should probably upgrade to a newer version of node as we')
    console.error("can't make any promises that npm will work with this version.")
    console.error('You can find the latest version at https://nodejs.org/')
  }
}

}, function(modId) { var map = {"../../package.json":1653046647756}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647756, function(require, module, exports) {
module.exports = {
  "version": "8.5.5",
  "name": "npm",
  "description": "a package manager for JavaScript",
  "workspaces": [
    "docs",
    "workspaces/*"
  ],
  "files": [
    "index.js",
    "bin",
    "docs/content/**/*.md",
    "docs/output/**/*.html",
    "lib",
    "man"
  ],
  "keywords": [
    "install",
    "modules",
    "package manager",
    "package.json"
  ],
  "preferGlobal": true,
  "config": {
    "publishtest": false
  },
  "homepage": "https://docs.npmjs.com/",
  "author": "Isaac Z. Schlueter <i@izs.me> (http://blog.izs.me)",
  "repository": {
    "type": "git",
    "url": "https://github.com/npm/cli"
  },
  "bugs": {
    "url": "https://github.com/npm/cli/issues"
  },
  "directories": {
    "bin": "./bin",
    "doc": "./doc",
    "lib": "./lib",
    "man": "./man"
  },
  "main": "./index.js",
  "bin": {
    "npm": "bin/npm-cli.js",
    "npx": "bin/npx-cli.js"
  },
  "exports": {
    ".": [
      {
        "default": "./index.js"
      },
      "./index.js"
    ],
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@isaacs/string-locale-compare": "^1.1.0",
    "@npmcli/arborist": "^5.0.3",
    "@npmcli/ci-detect": "^2.0.0",
    "@npmcli/config": "^4.0.1",
    "@npmcli/map-workspaces": "^2.0.2",
    "@npmcli/package-json": "^1.0.1",
    "@npmcli/run-script": "^3.0.1",
    "abbrev": "~1.1.1",
    "ansicolors": "~0.3.2",
    "ansistyles": "~0.1.3",
    "archy": "~1.0.0",
    "cacache": "^16.0.2",
    "chalk": "^4.1.2",
    "chownr": "^2.0.0",
    "cli-columns": "^4.0.0",
    "cli-table3": "^0.6.1",
    "columnify": "^1.6.0",
    "fastest-levenshtein": "^1.0.12",
    "glob": "^7.2.0",
    "graceful-fs": "^4.2.9",
    "hosted-git-info": "^5.0.0",
    "ini": "^2.0.0",
    "init-package-json": "^3.0.1",
    "is-cidr": "^4.0.2",
    "json-parse-even-better-errors": "^2.3.1",
    "libnpmaccess": "^6.0.2",
    "libnpmdiff": "^4.0.2",
    "libnpmexec": "^4.0.2",
    "libnpmfund": "^3.0.1",
    "libnpmhook": "^8.0.2",
    "libnpmorg": "^4.0.2",
    "libnpmpack": "^4.0.2",
    "libnpmpublish": "^6.0.2",
    "libnpmsearch": "^5.0.2",
    "libnpmteam": "^4.0.2",
    "libnpmversion": "^3.0.1",
    "make-fetch-happen": "^10.0.6",
    "minipass": "^3.1.6",
    "minipass-pipeline": "^1.2.4",
    "mkdirp": "^1.0.4",
    "mkdirp-infer-owner": "^2.0.0",
    "ms": "^2.1.2",
    "node-gyp": "^9.0.0",
    "nopt": "^5.0.0",
    "npm-audit-report": "^2.1.5",
    "npm-install-checks": "^4.0.0",
    "npm-package-arg": "^9.0.1",
    "npm-pick-manifest": "^7.0.0",
    "npm-profile": "^6.0.2",
    "npm-registry-fetch": "^13.0.1",
    "npm-user-validate": "^1.0.1",
    "npmlog": "^6.0.1",
    "opener": "^1.5.2",
    "pacote": "^13.0.5",
    "parse-conflict-json": "^2.0.1",
    "proc-log": "^2.0.0",
    "qrcode-terminal": "^0.12.0",
    "read": "~1.0.7",
    "read-package-json": "^5.0.0",
    "read-package-json-fast": "^2.0.3",
    "readdir-scoped-modules": "^1.1.0",
    "rimraf": "^3.0.2",
    "semver": "^7.3.5",
    "ssri": "^8.0.1",
    "tar": "^6.1.11",
    "text-table": "~0.2.0",
    "tiny-relative-date": "^1.3.0",
    "treeverse": "^1.0.4",
    "validate-npm-package-name": "~3.0.0",
    "which": "^2.0.2",
    "write-file-atomic": "^4.0.1"
  },
  "bundleDependencies": [
    "@isaacs/string-locale-compare",
    "@npmcli/arborist",
    "@npmcli/ci-detect",
    "@npmcli/config",
    "@npmcli/map-workspaces",
    "@npmcli/package-json",
    "@npmcli/run-script",
    "abbrev",
    "ansicolors",
    "ansistyles",
    "archy",
    "cacache",
    "chalk",
    "chownr",
    "cli-columns",
    "cli-table3",
    "columnify",
    "fastest-levenshtein",
    "glob",
    "graceful-fs",
    "hosted-git-info",
    "ini",
    "init-package-json",
    "is-cidr",
    "json-parse-even-better-errors",
    "libnpmaccess",
    "libnpmdiff",
    "libnpmexec",
    "libnpmfund",
    "libnpmhook",
    "libnpmorg",
    "libnpmpack",
    "libnpmpublish",
    "libnpmsearch",
    "libnpmteam",
    "libnpmversion",
    "make-fetch-happen",
    "minipass",
    "minipass-pipeline",
    "mkdirp",
    "mkdirp-infer-owner",
    "ms",
    "node-gyp",
    "nopt",
    "npm-audit-report",
    "npm-install-checks",
    "npm-package-arg",
    "npm-pick-manifest",
    "npm-profile",
    "npm-registry-fetch",
    "npm-user-validate",
    "npmlog",
    "opener",
    "pacote",
    "parse-conflict-json",
    "proc-log",
    "qrcode-terminal",
    "read",
    "read-package-json",
    "read-package-json-fast",
    "readdir-scoped-modules",
    "rimraf",
    "semver",
    "ssri",
    "tar",
    "text-table",
    "tiny-relative-date",
    "treeverse",
    "validate-npm-package-name",
    "which",
    "write-file-atomic"
  ],
  "devDependencies": {
    "@npmcli/eslint-config": "^2.0.0",
    "@npmcli/template-oss": "^2.9.2",
    "eslint": "^8.3.0",
    "licensee": "^8.2.0",
    "nock": "^13.2.4",
    "spawk": "^1.7.1",
    "tap": "^15.1.6"
  },
  "scripts": {
    "dumpconf": "env | grep npm | sort | uniq",
    "preversion": "bash scripts/update-authors.sh && git add AUTHORS && git commit -m \"update AUTHORS\" || true",
    "licenses": "licensee --production --errors-only",
    "test": "tap",
    "test-all": "npm run test --if-present --workspaces --include-workspace-root",
    "check-coverage": "tap",
    "snap": "tap",
    "postsnap": "make -s mandocs",
    "test:nocleanup": "NO_TEST_CLEANUP=1 npm run test --",
    "sudotest": "sudo npm run test --",
    "sudotest:nocleanup": "sudo NO_TEST_CLEANUP=1 npm run test --",
    "posttest": "npm run lint",
    "eslint": "eslint",
    "lint": "npm run eslint -- bin lib scripts smoke-tests test ./*.js",
    "lintfix": "npm run lint -- --fix",
    "prelint": "rimraf test/npm_cache*",
    "resetdeps": "bash scripts/resetdeps.sh",
    "smoke-tests": "tap smoke-tests/index.js"
  },
  "tap": {
    "test-env": [
      "LC_ALL=sk"
    ],
    "color": 1,
    "files": "test/{lib,bin,index.js}",
    "coverage-map": "test/coverage-map.js",
    "check-coverage": true,
    "timeout": 600
  },
  "templateOSS": {
    "applyRootRepoFiles": false,
    "applyWorkspaceRepoFiles": true,
    "applyRootModuleFiles": false,
    "workspaces": [
      "@npmcli/arborist",
      "libnpmaccess",
      "libnpmdiff",
      "libnpmfund",
      "libnpmexec",
      "libnpmorg",
      "libnpmhook",
      "libnpmpack",
      "libnpmpublish",
      "libnpmsearch",
      "libnpmteam",
      "libnpmversion"
    ],
    "version": "2.9.2"
  },
  "license": "Artistic-2.0",
  "engines": {
    "node": "^12.13.0 || ^14.15.0 || >=16"
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647757, function(require, module, exports) {
const os = require('os')
const log = require('./log-shim.js')

const errorMessage = require('./error-message.js')
const replaceInfo = require('./replace-info.js')

const messageText = msg => msg.map(line => line.slice(1).join(' ')).join('\n')

let npm = null // set by the cli
let exitHandlerCalled = false
let showLogFileMessage = false

process.on('exit', code => {
  log.disableProgress()

  // process.emit is synchronous, so the timeEnd handler will run before the
  // unfinished timer check below
  process.emit('timeEnd', 'npm')

  const hasNpm = !!npm
  const hasLoadedNpm = hasNpm && npm.config.loaded

  // Unfinished timers can be read before config load
  if (hasNpm) {
    for (const [name, timer] of npm.unfinishedTimers) {
      log.verbose('unfinished npm timer', name, timer)
    }
  }

  if (!code) {
    log.info('ok')
  } else {
    log.verbose('code', code)
  }

  if (!exitHandlerCalled) {
    process.exitCode = code || 1
    log.error('', 'Exit handler never called!')
    console.error('')
    log.error('', 'This is an error with npm itself. Please report this error at:')
    log.error('', '    <https://github.com/npm/cli/issues>')
    showLogFileMessage = true
  }

  // In timing mode we always show the log file message
  if (hasLoadedNpm && npm.config.get('timing')) {
    showLogFileMessage = true
  }

  // npm must be loaded to know where the log file was written
  if (showLogFileMessage && hasLoadedNpm) {
    // just a line break if not in silent mode
    if (!npm.silent) {
      console.error('')
    }

    log.error(
      '',
      [
        'A complete log of this run can be found in:',
        ...npm.logFiles.map(f => '    ' + f),
      ].join('\n')
    )
  }

  // This removes any listeners npm setup and writes files if necessary
  // This is mostly used for tests to avoid max listener warnings
  if (hasLoadedNpm) {
    npm.unload()
  }

  // these are needed for the tests to have a clean slate in each test case
  exitHandlerCalled = false
  showLogFileMessage = false
})

const exitHandler = err => {
  exitHandlerCalled = true

  log.disableProgress()

  const hasNpm = !!npm
  const hasLoadedNpm = hasNpm && npm.config.loaded

  if (!hasNpm) {
    err = err || new Error('Exit prior to setting npm in exit handler')
    console.error(err.stack || err.message)
    return process.exit(1)
  }

  if (!hasLoadedNpm) {
    err = err || new Error('Exit prior to config file resolving.')
    console.error(err.stack || err.message)
  }

  // only show the notification if it finished.
  if (typeof npm.updateNotification === 'string') {
    const { level } = log
    log.level = 'notice'
    log.notice('', npm.updateNotification)
    log.level = level
  }

  let exitCode
  let noLogMessage

  if (err) {
    exitCode = 1
    // if we got a command that just shells out to something else, then it
    // will presumably print its own errors and exit with a proper status
    // code if there's a problem.  If we got an error with a code=0, then...
    // something else went wrong along the way, so maybe an npm problem?
    const isShellout = npm.shelloutCommands.includes(npm.command)
    const quietShellout = isShellout && typeof err.code === 'number' && err.code
    if (quietShellout) {
      exitCode = err.code
      noLogMessage = true
    } else if (typeof err === 'string') {
      // XXX: we should stop throwing strings
      log.error('', err)
      noLogMessage = true
    } else if (!(err instanceof Error)) {
      log.error('weird error', err)
      noLogMessage = true
    } else {
      if (!err.code) {
        const matchErrorCode = err.message.match(/^(?:Error: )?(E[A-Z]+)/)
        err.code = matchErrorCode && matchErrorCode[1]
      }

      for (const k of ['type', 'stack', 'statusCode', 'pkgid']) {
        const v = err[k]
        if (v) {
          log.verbose(k, replaceInfo(v))
        }
      }

      const args = replaceInfo(process.argv)
      log.verbose('cwd', process.cwd())
      log.verbose('', os.type() + ' ' + os.release())
      log.verbose('argv', args.map(JSON.stringify).join(' '))
      log.verbose('node', process.version)
      log.verbose('npm ', 'v' + npm.version)

      for (const k of ['code', 'syscall', 'file', 'path', 'dest', 'errno']) {
        const v = err[k]
        if (v) {
          log.error(k, v)
        }
      }

      const msg = errorMessage(err, npm)
      for (const errline of [...msg.summary, ...msg.detail]) {
        log.error(...errline)
      }

      if (hasLoadedNpm && npm.config.get('json')) {
        const error = {
          error: {
            code: err.code,
            summary: messageText(msg.summary),
            detail: messageText(msg.detail),
          },
        }
        console.error(JSON.stringify(error, null, 2))
      }

      if (typeof err.errno === 'number') {
        exitCode = err.errno
      } else if (typeof err.code === 'number') {
        exitCode = err.code
      }
    }
  }

  log.verbose('exit', exitCode || 0)

  showLogFileMessage = (hasLoadedNpm && npm.silent) || noLogMessage
    ? false
    : !!exitCode

  // explicitly call process.exit now so we don't hang on things like the
  // update notifier, also flush stdout beforehand because process.exit doesn't
  // wait for that to happen.
  process.stdout.write('', () => process.exit(exitCode))
}

module.exports = exitHandler
module.exports.setNpm = n => {
  npm = n
}

}, function(modId) { var map = {"./log-shim.js":1653046647758,"./error-message.js":1653046647759,"./replace-info.js":1653046647761}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647758, function(require, module, exports) {
const NPMLOG = require('npmlog')
const PROCLOG = require('proc-log')

// Sets getter and optionally a setter
// otherwise setting should throw
const accessors = (obj, set) => (k) => ({
  get: () => obj[k],
  set: set ? (v) => (obj[k] = v) : () => {
    throw new Error(`Cant set ${k}`)
  },
})

// Set the value to a bound function on the object
const value = (obj) => (k) => ({
  value: (...args) => obj[k].apply(obj, args),
})

const properties = {
  // npmlog getters/setters
  level: accessors(NPMLOG, true),
  heading: accessors(NPMLOG, true),
  levels: accessors(NPMLOG),
  gauge: accessors(NPMLOG),
  stream: accessors(NPMLOG),
  tracker: accessors(NPMLOG),
  progressEnabled: accessors(NPMLOG),
  // npmlog methods
  useColor: value(NPMLOG),
  enableColor: value(NPMLOG),
  disableColor: value(NPMLOG),
  enableUnicode: value(NPMLOG),
  disableUnicode: value(NPMLOG),
  enableProgress: value(NPMLOG),
  disableProgress: value(NPMLOG),
  clearProgress: value(NPMLOG),
  showProgress: value(NPMLOG),
  newItem: value(NPMLOG),
  newGroup: value(NPMLOG),
  // proclog methods
  notice: value(PROCLOG),
  error: value(PROCLOG),
  warn: value(PROCLOG),
  info: value(PROCLOG),
  verbose: value(PROCLOG),
  http: value(PROCLOG),
  silly: value(PROCLOG),
  pause: value(PROCLOG),
  resume: value(PROCLOG),
}

const descriptors = Object.entries(properties).reduce((acc, [k, v]) => {
  acc[k] = { enumerable: true, ...v(k) }
  return acc
}, {})

// Create an object with the allowed properties rom npm log and all
// the logging methods from proc log
// XXX: this should go away and requires of this should be replaced with proc-log + new display
module.exports = Object.freeze(Object.defineProperties({}, descriptors))

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647759, function(require, module, exports) {
const { format } = require('util')
const { resolve } = require('path')
const nameValidator = require('validate-npm-package-name')
const replaceInfo = require('./replace-info.js')
const { report } = require('./explain-eresolve.js')
const log = require('./log-shim')

module.exports = (er, npm) => {
  const short = []
  const detail = []

  if (er.message) {
    er.message = replaceInfo(er.message)
  }
  if (er.stack) {
    er.stack = replaceInfo(er.stack)
  }

  switch (er.code) {
    case 'ERESOLVE':
      short.push(['ERESOLVE', er.message])
      detail.push(['', ''])
      // XXX(display): error messages are logged so we use the logColor since that is based
      // on stderr. This should be handled solely by the display layer so it could also be
      // printed to stdout if necessary.
      detail.push(['', report(er, !!npm.logColor, resolve(npm.cache, 'eresolve-report.txt'))])
      break

    case 'ENOLOCK': {
      const cmd = npm.command || ''
      short.push([cmd, 'This command requires an existing lockfile.'])
      detail.push([cmd, 'Try creating one first with: npm i --package-lock-only'])
      detail.push([cmd, `Original error: ${er.message}`])
      break
    }

    case 'ENOAUDIT':
      short.push(['audit', er.message])
      break

    case 'ECONNREFUSED':
      short.push(['', er])
      detail.push([
        '',
        [
          '\nIf you are behind a proxy, please make sure that the',
          "'proxy' config is set properly.  See: 'npm help config'",
        ].join('\n'),
      ])
      break

    case 'EACCES':
    case 'EPERM': {
      const isCachePath =
        typeof er.path === 'string' &&
        npm.config.loaded &&
        er.path.startsWith(npm.config.get('cache'))
      const isCacheDest =
        typeof er.dest === 'string' &&
        npm.config.loaded &&
        er.dest.startsWith(npm.config.get('cache'))

      const isWindows = require('./is-windows.js')

      if (!isWindows && (isCachePath || isCacheDest)) {
        // user probably doesn't need this, but still add it to the debug log
        log.verbose(er.stack)
        short.push([
          '',
          [
            '',
            'Your cache folder contains root-owned files, due to a bug in',
            'previous versions of npm which has since been addressed.',
            '',
            'To permanently fix this problem, please run:',
            `  sudo chown -R ${process.getuid()}:${process.getgid()} ${JSON.stringify(
              npm.config.get('cache')
            )}`,
          ].join('\n'),
        ])
      } else {
        short.push(['', er])
        detail.push([
          '',
          [
            '\nThe operation was rejected by your operating system.',
            isWindows
              /* eslint-disable-next-line max-len */
              ? "It's possible that the file was already in use (by a text editor or antivirus),\n" +
                'or that you lack permissions to access it.'
              /* eslint-disable-next-line max-len */
              : 'It is likely you do not have the permissions to access this file as the current user',
            '\nIf you believe this might be a permissions issue, please double-check the',
            'permissions of the file and its containing directories, or try running',
            'the command again as root/Administrator.',
          ].join('\n'),
        ])
      }
      break
    }

    case 'ENOGIT':
      short.push(['', er.message])
      detail.push([
        '',
        ['', 'Failed using git.', 'Please check if you have git installed and in your PATH.'].join(
          '\n'
        ),
      ])
      break

    case 'EJSONPARSE':
      // Check whether we ran into a conflict in our own package.json
      if (er.path === resolve(npm.prefix, 'package.json')) {
        const { isDiff } = require('parse-conflict-json')
        const txt = require('fs').readFileSync(er.path, 'utf8').replace(/\r\n/g, '\n')
        if (isDiff(txt)) {
          detail.push([
            '',
            [
              'Merge conflict detected in your package.json.',
              '',
              'Please resolve the package.json conflict and retry.',
            ].join('\n'),
          ])
          break
        }
      }
      short.push(['JSON.parse', er.message])
      detail.push([
        'JSON.parse',
        [
          'Failed to parse JSON data.',
          'Note: package.json must be actual JSON, not just JavaScript.',
        ].join('\n'),
      ])
      break

    case 'EOTP':
    case 'E401':
      // E401 is for places where we accidentally neglect OTP stuff
      if (er.code === 'EOTP' || /one-time pass/.test(er.message)) {
        short.push(['', 'This operation requires a one-time password from your authenticator.'])
        detail.push([
          '',
          [
            'You can provide a one-time password by passing --otp=<code> to the command you ran.',
            'If you already provided a one-time password then it is likely that you either typoed',
            'it, or it timed out. Please try again.',
          ].join('\n'),
        ])
      } else {
        // npm ERR! code E401
        // npm ERR! Unable to authenticate, need: Basic
        const auth =
          !er.headers || !er.headers['www-authenticate']
            ? []
            : er.headers['www-authenticate'].map(au => au.split(/[,\s]+/))[0]

        if (auth.includes('Bearer')) {
          short.push([
            '',
            'Unable to authenticate, your authentication token seems to be invalid.',
          ])
          detail.push([
            '',
            ['To correct this please trying logging in again with:', '    npm login'].join('\n'),
          ])
        } else if (auth.includes('Basic')) {
          short.push(['', 'Incorrect or missing password.'])
          detail.push([
            '',
            [
              'If you were trying to login, change your password, create an',
              'authentication token or enable two-factor authentication then',
              'that means you likely typed your password in incorrectly.',
              'Please try again, or recover your password at:',
              '    https://www.npmjs.com/forgot',
              '',
              'If you were doing some other operation then your saved credentials are',
              'probably out of date. To correct this please try logging in again with:',
              '    npm login',
            ].join('\n'),
          ])
        } else {
          short.push(['', er.message || er])
        }
      }
      break

    case 'E404':
      // There's no need to have 404 in the message as well.
      short.push(['404', er.message.replace(/^404\s+/, '')])
      if (er.pkgid && er.pkgid !== '-') {
        const pkg = er.pkgid.replace(/(?!^)@.*$/, '')

        detail.push(['404', ''])
        detail.push(['404', '', `'${replaceInfo(er.pkgid)}' is not in this registry.`])

        const valResult = nameValidator(pkg)

        if (!valResult.validForNewPackages) {
          detail.push(['404', 'This package name is not valid, because', ''])

          const errorsArray = [...(valResult.errors || []), ...(valResult.warnings || [])]
          errorsArray.forEach((item, idx) => detail.push(['404', ' ' + (idx + 1) + '. ' + item]))
        }

        detail.push(['404', '\nNote that you can also install from a'])
        detail.push(['404', 'tarball, folder, http url, or git url.'])
      }
      break

    case 'EPUBLISHCONFLICT':
      short.push(['publish fail', 'Cannot publish over existing version.'])
      detail.push(['publish fail', "Update the 'version' field in package.json and try again."])
      detail.push(['publish fail', ''])
      detail.push(['publish fail', 'To automatically increment version numbers, see:'])
      detail.push(['publish fail', '    npm help version'])
      break

    case 'EISGIT':
      short.push(['git', er.message])
      short.push(['git', '    ' + er.path])
      detail.push([
        'git',
        ['Refusing to remove it. Update manually,', 'or move it out of the way first.'].join('\n'),
      ])
      break

    case 'EBADPLATFORM': {
      const validOs =
        er.required && er.required.os && er.required.os.join
          ? er.required.os.join(',')
          : er.required.os
      const validArch =
        er.required && er.required.cpu && er.required.cpu.join
          ? er.required.cpu.join(',')
          : er.required.cpu
      const expected = { os: validOs, arch: validArch }
      const actual = { os: process.platform, arch: process.arch }
      short.push([
        'notsup',
        [
          format(
            'Unsupported platform for %s: wanted %j (current: %j)',
            er.pkgid,
            expected,
            actual
          ),
        ].join('\n'),
      ])
      detail.push([
        'notsup',
        [
          'Valid OS:    ' + validOs,
          'Valid Arch:  ' + validArch,
          'Actual OS:   ' + process.platform,
          'Actual Arch: ' + process.arch,
        ].join('\n'),
      ])
      break
    }

    case 'EEXIST':
      short.push(['', er.message])
      short.push(['', 'File exists: ' + (er.dest || er.path)])
      detail.push(['', 'Remove the existing file and try again, or run npm'])
      detail.push(['', 'with --force to overwrite files recklessly.'])
      break

    case 'ENEEDAUTH':
      short.push(['need auth', er.message])
      detail.push(['need auth', 'You need to authorize this machine using `npm adduser`'])
      break

    case 'ECONNRESET':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
    case 'ERR_SOCKET_TIMEOUT':
    case 'EAI_FAIL':
      short.push(['network', er.message])
      detail.push([
        'network',
        [
          'This is a problem related to network connectivity.',
          'In most cases you are behind a proxy or have bad network settings.',
          '\nIf you are behind a proxy, please make sure that the',
          "'proxy' config is set properly.  See: 'npm help config'",
        ].join('\n'),
      ])
      break

    case 'ETARGET':
      short.push(['notarget', er.message])
      detail.push([
        'notarget',
        [
          'In most cases you or one of your dependencies are requesting',
          "a package version that doesn't exist.",
        ].join('\n'),
      ])
      break

    case 'E403':
      short.push(['403', er.message])
      detail.push([
        '403',
        [
          'In most cases, you or one of your dependencies are requesting',
          'a package version that is forbidden by your security policy, or',
          'on a server you do not have access to.',
        ].join('\n'),
      ])
      break

    case 'EBADENGINE':
      short.push(['engine', er.message])
      short.push(['engine', 'Not compatible with your version of node/npm: ' + er.pkgid])
      detail.push([
        'notsup',
        [
          'Not compatible with your version of node/npm: ' + er.pkgid,
          'Required: ' + JSON.stringify(er.required),
          'Actual:   ' +
            JSON.stringify({
              npm: npm.version,
              node: npm.config.loaded ? npm.config.get('node-version') : process.version,
            }),
        ].join('\n'),
      ])
      break

    case 'ENOSPC':
      short.push(['nospc', er.message])
      detail.push([
        'nospc',
        [
          'There appears to be insufficient space on your system to finish.',
          'Clear up some disk space and try again.',
        ].join('\n'),
      ])
      break

    case 'EROFS':
      short.push(['rofs', er.message])
      detail.push([
        'rofs',
        [
          'Often virtualized file systems, or other file systems',
          "that don't support symlinks, give this error.",
        ].join('\n'),
      ])
      break

    case 'ENOENT':
      short.push(['enoent', er.message])
      detail.push([
        'enoent',
        [
          'This is related to npm not being able to find a file.',
          er.file ? "\nCheck if the file '" + er.file + "' is present." : '',
        ].join('\n'),
      ])
      break

    case 'EMISSINGARG':
    case 'EUNKNOWNTYPE':
    case 'EINVALIDTYPE':
    case 'ETOOMANYARGS':
      short.push(['typeerror', er.stack])
      detail.push([
        'typeerror',
        [
          'This is an error with npm itself. Please report this error at:',
          '    https://github.com/npm/cli/issues',
        ].join('\n'),
      ])
      break

    default:
      short.push(['', er.message || er])
      if (er.signal) {
        detail.push(['signal', er.signal])
      }

      if (er.cmd && Array.isArray(er.args)) {
        detail.push(['command', ...[er.cmd, ...er.args.map(replaceInfo)]])
      }

      if (er.stdout) {
        detail.push(['', er.stdout.trim()])
      }

      if (er.stderr) {
        detail.push(['', er.stderr.trim()])
      }

      break
  }
  return { summary: short, detail: detail }
}

}, function(modId) { var map = {"path":1653046647760,"./replace-info.js":1653046647761,"./explain-eresolve.js":1653046647762,"./log-shim":1653046647758,"./is-windows.js":1653046647764}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647760, function(require, module, exports) {
// return the PATH array in a cross-platform way
const PATH = process.env.PATH || process.env.Path || process.env.path
const { delimiter } = require('path')
module.exports = PATH.split(delimiter)

}, function(modId) { var map = {"path":1653046647760}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647761, function(require, module, exports) {
const URL = require('url').URL

// replaces auth info in an array of arguments or in a strings
function replaceInfo (arg) {
  const isArray = Array.isArray(arg)
  const isString = str => typeof str === 'string'

  if (!isArray && !isString(arg)) {
    return arg
  }

  const testUrlAndReplace = str => {
    try {
      const url = new URL(str)
      return url.password === '' ? str : str.replace(url.password, '***')
    } catch (e) {
      return str
    }
  }

  const args = isString(arg) ? arg.split(' ') : arg
  const info = args.map(a => {
    if (isString(a) && a.indexOf(' ') > -1) {
      return a.split(' ').map(testUrlAndReplace).join(' ')
    }

    return testUrlAndReplace(a)
  })

  return isString(arg) ? info.join(' ') : info
}

module.exports = replaceInfo

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647762, function(require, module, exports) {
// this is called when an ERESOLVE error is caught in the exit-handler,
// or when there's a log.warn('eresolve', msg, explanation), to turn it
// into a human-intelligible explanation of what's wrong and how to fix.
const { writeFileSync } = require('fs')
const { explainEdge, explainNode, printNode } = require('./explain-dep.js')

// expl is an explanation object that comes from Arborist.  It looks like:
// Depth is how far we want to want to descend into the object making a report.
// The full report (ie, depth=Infinity) is always written to the cache folder
// at ${cache}/eresolve-report.txt along with full json.
const explain = (expl, color, depth) => {
  const { edge, dep, current, peerConflict, currentEdge } = expl

  const out = []
  const whileInstalling = dep && dep.whileInstalling ||
    current && current.whileInstalling ||
    edge && edge.from && edge.from.whileInstalling
  if (whileInstalling) {
    out.push('While resolving: ' + printNode(whileInstalling, color))
  }

  // it "should" be impossible for an ERESOLVE explanation to lack both
  // current and currentEdge, but better to have a less helpful error
  // than a crashing failure.
  if (current) {
    out.push('Found: ' + explainNode(current, depth, color))
  } else if (peerConflict && peerConflict.current) {
    out.push('Found: ' + explainNode(peerConflict.current, depth, color))
  } else if (currentEdge) {
    out.push('Found: ' + explainEdge(currentEdge, depth, color))
  } else /* istanbul ignore else - should always have one */ if (edge) {
    out.push('Found: ' + explainEdge(edge, depth, color))
  }

  out.push('\nCould not resolve dependency:\n' +
    explainEdge(edge, depth, color))

  if (peerConflict) {
    const heading = '\nConflicting peer dependency:'
    const pc = explainNode(peerConflict.peer, depth, color)
    out.push(heading + ' ' + pc)
  }

  return out.join('\n')
}

// generate a full verbose report and tell the user how to fix it
const report = (expl, color, fullReport) => {
  const orNoStrict = expl.strictPeerDeps ? '--no-strict-peer-deps, ' : ''
  const fix = `Fix the upstream dependency conflict, or retry
this command with ${orNoStrict}--force, or --legacy-peer-deps
to accept an incorrect (and potentially broken) dependency resolution.`

  writeFileSync(fullReport, `# npm resolution error report

${new Date().toISOString()}

${explain(expl, false, Infinity)}

${fix}

Raw JSON explanation object:

${JSON.stringify(expl, null, 2)}
`, 'utf8')

  return explain(expl, color, 4) +
    `\n\n${fix}\n\nSee ${fullReport} for a full report.`
}

module.exports = {
  explain,
  report,
}

}, function(modId) { var map = {"./explain-dep.js":1653046647763}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647763, function(require, module, exports) {
const chalk = require('chalk')
const nocolor = {
  bold: s => s,
  dim: s => s,
  red: s => s,
  yellow: s => s,
  cyan: s => s,
  magenta: s => s,
  blue: s => s,
  green: s => s,
}

const { relative } = require('path')

const explainNode = (node, depth, color) =>
  printNode(node, color) +
  explainDependents(node, depth, color) +
  explainLinksIn(node, depth, color)

const colorType = (type, color) => {
  const { red, yellow, cyan, magenta, blue, green } = color ? chalk : nocolor
  const style = type === 'extraneous' ? red
    : type === 'dev' ? yellow
    : type === 'optional' ? cyan
    : type === 'peer' ? magenta
    : type === 'bundled' ? blue
    : type === 'workspace' ? green
    : /* istanbul ignore next */ s => s
  return style(type)
}

const printNode = (node, color) => {
  const {
    name,
    version,
    location,
    extraneous,
    dev,
    optional,
    peer,
    bundled,
    isWorkspace,
  } = node
  const { bold, dim, green } = color ? chalk : nocolor
  const extra = []
  if (extraneous) {
    extra.push(' ' + bold(colorType('extraneous', color)))
  }

  if (dev) {
    extra.push(' ' + bold(colorType('dev', color)))
  }

  if (optional) {
    extra.push(' ' + bold(colorType('optional', color)))
  }

  if (peer) {
    extra.push(' ' + bold(colorType('peer', color)))
  }

  if (bundled) {
    extra.push(' ' + bold(colorType('bundled', color)))
  }

  const pkgid = isWorkspace
    ? green(`${name}@${version}`)
    : `${bold(name)}@${bold(version)}`

  return `${pkgid}${extra.join('')}` +
    (location ? dim(`\n${location}`) : '')
}

const explainLinksIn = ({ linksIn }, depth, color) => {
  if (!linksIn || !linksIn.length || depth <= 0) {
    return ''
  }

  const messages = linksIn.map(link => explainNode(link, depth - 1, color))
  const str = '\n' + messages.join('\n')
  return str.split('\n').join('\n  ')
}

const explainDependents = ({ name, dependents }, depth, color) => {
  if (!dependents || !dependents.length || depth <= 0) {
    return ''
  }

  const max = Math.ceil(depth / 2)
  const messages = dependents.slice(0, max)
    .map(edge => explainEdge(edge, depth, color))

  // show just the names of the first 5 deps that overflowed the list
  if (dependents.length > max) {
    let len = 0
    const maxLen = 50
    const showNames = []
    for (let i = max; i < dependents.length; i++) {
      const { from: { name = 'the root project' } } = dependents[i]
      len += name.length
      if (len >= maxLen && i < dependents.length - 1) {
        showNames.push('...')
        break
      }
      showNames.push(name)
    }
    const show = `(${showNames.join(', ')})`
    messages.push(`${dependents.length - max} more ${show}`)
  }

  const str = '\n' + messages.join('\n')
  return str.split('\n').join('\n  ')
}

const explainEdge = ({ name, type, bundled, from, spec }, depth, color) => {
  const { bold } = color ? chalk : nocolor
  const dep = type === 'workspace'
    ? bold(relative(from.location, spec.slice('file:'.length)))
    : `${bold(name)}@"${bold(spec)}"`
  const fromMsg = ` from ${explainFrom(from, depth, color)}`

  return (type === 'prod' ? '' : `${colorType(type, color)} `) +
    (bundled ? `${colorType('bundled', color)} ` : '') +
    `${dep}${fromMsg}`
}

const explainFrom = (from, depth, color) => {
  if (!from.name && !from.version) {
    return 'the root project'
  }

  return printNode(from, color) +
    explainDependents(from, depth - 1, color) +
    explainLinksIn(from, depth - 1, color)
}

module.exports = { explainNode, printNode, explainEdge }

}, function(modId) { var map = {"path":1653046647760}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647764, function(require, module, exports) {
module.exports = process.platform === 'win32'

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647766, function(require, module, exports) {
// print a banner telling the user to upgrade npm to latest
// but not in CI, and not if we're doing that already.
// Check daily for betas, and weekly otherwise.

const pacote = require('pacote')
const ciDetect = require('@npmcli/ci-detect')
const semver = require('semver')
const chalk = require('chalk')
const { promisify } = require('util')
const stat = promisify(require('fs').stat)
const writeFile = promisify(require('fs').writeFile)
const { resolve } = require('path')

const isGlobalNpmUpdate = npm => {
  return npm.flatOptions.global &&
    ['install', 'update'].includes(npm.command) &&
    npm.argv.some(arg => /^npm(@|$)/.test(arg))
}

// update check frequency
const DAILY = 1000 * 60 * 60 * 24
const WEEKLY = DAILY * 7

// don't put it in the _cacache folder, just in npm's cache
const lastCheckedFile = npm =>
  resolve(npm.flatOptions.cache, '../_update-notifier-last-checked')

const checkTimeout = async (npm, duration) => {
  const t = new Date(Date.now() - duration)
  const f = lastCheckedFile(npm)
  // if we don't have a file, then definitely check it.
  const st = await stat(f).catch(() => ({ mtime: t - 1 }))
  return t > st.mtime
}

const updateNotifier = async (npm, spec = 'latest') => {
  // never check for updates in CI, when updating npm already, or opted out
  if (!npm.config.get('update-notifier') ||
      isGlobalNpmUpdate(npm) ||
      ciDetect()) {
    return null
  }

  // if we're on a prerelease train, then updates are coming fast
  // check for a new one daily.  otherwise, weekly.
  const { version } = npm
  const current = semver.parse(version)

  // if we're on a beta train, always get the next beta
  if (current.prerelease.length) {
    spec = `^${version}`
  }

  // while on a beta train, get updates daily
  const duration = spec !== 'latest' ? DAILY : WEEKLY

  // if we've already checked within the specified duration, don't check again
  if (!(await checkTimeout(npm, duration))) {
    return null
  }

  // if they're currently using a prerelease, nudge to the next prerelease
  // otherwise, nudge to latest.
  const useColor = npm.logColor

  const mani = await pacote.manifest(`npm@${spec}`, {
    // always prefer latest, even if doing --tag=whatever on the cmd
    defaultTag: 'latest',
    ...npm.flatOptions,
  }).catch(() => null)

  // if pacote failed, give up
  if (!mani) {
    return null
  }

  const latest = mani.version

  // if the current version is *greater* than latest, we're on a 'next'
  // and should get the updates from that release train.
  // Note that this isn't another http request over the network, because
  // the packument will be cached by pacote from previous request.
  if (semver.gt(version, latest) && spec === 'latest') {
    return updateNotifier(npm, `^${version}`)
  }

  // if we already have something >= the desired spec, then we're done
  if (semver.gte(version, latest)) {
    return null
  }

  // ok!  notify the user about this update they should get.
  // The message is saved for printing at process exit so it will not get
  // lost in any other messages being printed as part of the command.
  const update = semver.parse(mani.version)
  const type = update.major !== current.major ? 'major'
    : update.minor !== current.minor ? 'minor'
    : update.patch !== current.patch ? 'patch'
    : 'prerelease'
  const typec = !useColor ? type
    : type === 'major' ? chalk.red(type)
    : type === 'minor' ? chalk.yellow(type)
    : chalk.green(type)
  const oldc = !useColor ? current : chalk.red(current)
  const latestc = !useColor ? latest : chalk.green(latest)
  const changelog = `https://github.com/npm/cli/releases/tag/v${latest}`
  const changelogc = !useColor ? `<${changelog}>` : chalk.cyan(changelog)
  const cmd = `npm install -g npm@${latest}`
  const cmdc = !useColor ? `\`${cmd}\`` : chalk.green(cmd)
  const message = `\nNew ${typec} version of npm available! ` +
    `${oldc} -> ${latestc}\n` +
    `Changelog: ${changelogc}\n` +
    `Run ${cmdc} to update!\n`

  return message
}

// only update the notification timeout if we actually finished checking
module.exports = async npm => {
  const notification = await updateNotifier(npm)
  // intentional.  do not await this.  it's a best-effort update.  if this
  // fails, it's ok.  might be using /dev/null as the cache or something weird
  // like that.
  writeFile(lastCheckedFile(npm), '').catch(() => {})
  npm.updateNotification = notification
}

}, function(modId) { var map = {"path":1653046647760}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647767, function(require, module, exports) {
const { distance } = require('fastest-levenshtein')
const readJson = require('read-package-json-fast')
const { cmdList } = require('./cmd-list.js')

const didYouMean = async (npm, path, scmd) => {
  // const cmd = await npm.cmd(str)
  const close = cmdList.filter(cmd => distance(scmd, cmd) < scmd.length * 0.4 && scmd !== cmd)
  let best = []
  for (const str of close) {
    const cmd = await npm.cmd(str)
    best.push(`    npm ${str} # ${cmd.description}`)
  }
  // We would already be suggesting this in `npm x` so omit them here
  const runScripts = ['stop', 'start', 'test', 'restart']
  try {
    const { bin, scripts } = await readJson(`${path}/package.json`)
    best = best.concat(
      Object.keys(scripts || {})
        .filter(cmd => distance(scmd, cmd) < scmd.length * 0.4 && !runScripts.includes(cmd))
        .map(str => `    npm run ${str} # run the "${str}" package script`),
      Object.keys(bin || {})
        .filter(cmd => distance(scmd, cmd) < scmd.length * 0.4)
        /* eslint-disable-next-line max-len */
        .map(str => `    npm exec ${str} # run the "${str}" command from either this or a remote npm package`)
    )
  } catch (_) {
    // gracefully ignore not being in a folder w/ a package.json
  }

  if (best.length === 0) {
    return ''
  }

  const suggestion =
    best.length === 1
      ? `\n\nDid you mean this?\n${best[0]}`
      : `\n\nDid you mean one of these?\n${best.slice(0, 3).join('\n')}`
  return suggestion
}
module.exports = didYouMean

}, function(modId) { var map = {"./cmd-list.js":1653046647768}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046647768, function(require, module, exports) {
// short names for common things
const shorthands = {
  un: 'uninstall',
  rb: 'rebuild',
  list: 'ls',
  ln: 'link',
  create: 'init',
  i: 'install',
  it: 'install-test',
  cit: 'install-ci-test',
  up: 'update',
  c: 'config',
  s: 'search',
  se: 'search',
  tst: 'test',
  t: 'test',
  ddp: 'dedupe',
  v: 'view',
  run: 'run-script',
  'clean-install': 'ci',
  'clean-install-test': 'cit',
  x: 'exec',
  why: 'explain',
}

const affordances = {
  la: 'll',
  verison: 'version',
  ic: 'ci',
  innit: 'init',
  // manually abbrev so that install-test doesn't make insta stop working
  in: 'install',
  ins: 'install',
  inst: 'install',
  insta: 'install',
  instal: 'install',
  isnt: 'install',
  isnta: 'install',
  isntal: 'install',
  isntall: 'install',
  'install-clean': 'ci',
  'isntall-clean': 'ci',
  hlep: 'help',
  'dist-tags': 'dist-tag',
  upgrade: 'update',
  udpate: 'update',
  login: 'adduser',
  'add-user': 'adduser',
  author: 'owner',
  home: 'docs',
  issues: 'bugs',
  info: 'view',
  show: 'view',
  find: 'search',
  add: 'install',
  unlink: 'uninstall',
  remove: 'uninstall',
  rm: 'uninstall',
  r: 'uninstall',
  rum: 'run-script',
  sit: 'cit',
  urn: 'run-script',
  ogr: 'org',
}

// these are filenames in .
const cmdList = [
  'ci',
  'install-ci-test',
  'install',
  'install-test',
  'uninstall',
  'cache',
  'config',
  'set',
  'get',
  'update',
  'outdated',
  'prune',
  'pack',
  'find-dupes',
  'dedupe',
  'hook',

  'rebuild',
  'link',

  'publish',
  'star',
  'stars',
  'unstar',
  'adduser',
  'login', // This is an alias for `adduser` but it can be confusing
  'logout',
  'unpublish',
  'owner',
  'access',
  'team',
  'deprecate',
  'shrinkwrap',
  'token',
  'profile',
  'audit',
  'fund',
  'org',

  'help',
  'ls',
  'll',
  'search',
  'view',
  'init',
  'version',
  'edit',
  'explore',
  'docs',
  'repo',
  'bugs',
  'root',
  'prefix',
  'bin',
  'whoami',
  'diff',
  'dist-tag',
  'ping',
  'pkg',

  'test',
  'stop',
  'start',
  'restart',
  'run-script',
  'set-script',
  'completion',
  'doctor',
  'exec',
  'explain',
]

const plumbing = ['birthday', 'help-search']

// these commands just shell out to something else or handle the
// error themselves, so it's confusing and weird to write out
// our full error log banner when they exit non-zero
const shellouts = [
  'exec',
  'run-script',
  'test',
  'start',
  'stop',
  'restart',
  'birthday',
]

module.exports = {
  aliases: Object.assign({}, shorthands, affordances),
  shorthands,
  affordances,
  cmdList,
  plumbing,
  shellouts,
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046647753);
})()
//miniprogram-npm-outsideDeps=["./npm.js","semver","os","npmlog","proc-log","util","validate-npm-package-name","parse-conflict-json","fs","url","chalk","pacote","@npmcli/ci-detect","fastest-levenshtein","read-package-json-fast"]
//# sourceMappingURL=index.js.map