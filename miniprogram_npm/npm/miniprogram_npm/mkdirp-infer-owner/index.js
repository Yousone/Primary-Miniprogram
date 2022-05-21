module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642267, function(require, module, exports) {
const inferOwner = require('infer-owner')
const mkdirp = require('mkdirp')
const {promisify} = require('util')
const chownr = promisify(require('chownr'))

const platform = process.env.__TESTING_MKDIRP_INFER_OWNER_PLATFORM__
  || process.platform
const isWindows = platform === 'win32'
const isRoot = process.getuid && process.getuid() === 0
const doChown = !isWindows && isRoot

module.exports = !doChown ? (path, opts) => mkdirp(path, opts)
  : (path, opts) => inferOwner(path).then(({uid, gid}) =>
    mkdirp(path, opts).then(made =>
      uid !== 0 || gid !== process.getgid()
      ? chownr(made || path, uid, gid).then(() => made)
      : made))

module.exports.sync = !doChown ? (path, opts) => mkdirp.sync(path, opts)
  : (path, opts) => {
    const {uid, gid} = inferOwner.sync(path)
    const made = mkdirp.sync(path)
    if (uid !== 0 || gid !== process.getgid())
      chownr.sync(made || path, uid, gid)
    return made
  }

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642267);
})()
//miniprogram-npm-outsideDeps=["infer-owner","mkdirp","util","chownr"]
//# sourceMappingURL=index.js.map