module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046641978, function(require, module, exports) {
const {spawn} = require('child_process')

const inferOwner = require('infer-owner')

const isPipe = (stdio = 'pipe', fd) =>
  stdio === 'pipe' || stdio === null ? true
  : Array.isArray(stdio) ? isPipe(stdio[fd], fd)
  : false

// 'extra' object is for decorating the error a bit more
const promiseSpawn = (cmd, args, opts, extra = {}) => {
  const cwd = opts.cwd || process.cwd()
  const isRoot = process.getuid && process.getuid() === 0
  const { uid, gid } = isRoot ? inferOwner.sync(cwd) : {}
  return promiseSpawnUid(cmd, args, {
    ...opts,
    cwd,
    uid,
    gid
  }, extra)
}

const stdioResult = (stdout, stderr, {stdioString, stdio}) =>
  stdioString ? {
    stdout: isPipe(stdio, 1) ? Buffer.concat(stdout).toString() : null,
    stderr: isPipe(stdio, 2) ? Buffer.concat(stderr).toString() : null,
  }
  : {
    stdout: isPipe(stdio, 1) ? Buffer.concat(stdout) : null,
    stderr: isPipe(stdio, 2) ? Buffer.concat(stderr) : null,
  }

const promiseSpawnUid = (cmd, args, opts, extra) => {
  let proc
  const p = new Promise((res, rej) => {
    proc = spawn(cmd, args, opts)
    const stdout = []
    const stderr = []
    const reject = er => rej(Object.assign(er, {
      cmd,
      args,
      ...stdioResult(stdout, stderr, opts),
      ...extra,
    }))
    proc.on('error', reject)
    if (proc.stdout) {
      proc.stdout.on('data', c => stdout.push(c)).on('error', reject)
      proc.stdout.on('error', er => reject(er))
    }
    if (proc.stderr) {
      proc.stderr.on('data', c => stderr.push(c)).on('error', reject)
      proc.stderr.on('error', er => reject(er))
    }
    proc.on('close', (code, signal) => {
      const result = {
        cmd,
        args,
        code,
        signal,
        ...stdioResult(stdout, stderr, opts),
        ...extra
      }
      if (code || signal)
        rej(Object.assign(new Error('command failed'), result))
      else
        res(result)
    })
  })

  p.stdin = proc.stdin
  p.process = proc
  return p
}

module.exports = promiseSpawn

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046641978);
})()
//miniprogram-npm-outsideDeps=["child_process","infer-owner"]
//# sourceMappingURL=index.js.map