module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642300, function(require, module, exports) {
const {format} = require('util')
const semver = require('semver')

const checkEngine = (target, npmVer, nodeVer, force = false) => {
  const nodev = force ? null : nodeVer
  const eng = target.engines
  const opt = { includePrerelease: true }
  if (!eng) {
    return
  }

  const nodeFail = nodev && eng.node && !semver.satisfies(nodev, eng.node, opt)
  const npmFail = npmVer && eng.npm && !semver.satisfies(npmVer, eng.npm, opt)
  if (nodeFail || npmFail) {
    throw Object.assign(new Error('Unsupported engine'), {
      pkgid: target._id,
      current: { node: nodeVer, npm: npmVer },
      required: eng,
      code: 'EBADENGINE'
    })
  }
}

const checkPlatform = (target, force = false) => {
  if (force) {
    return
  }

  const platform = process.platform
  const arch = process.arch
  const osOk = target.os ? checkList(platform, target.os) : true
  const cpuOk = target.cpu ? checkList(arch, target.cpu) : true

  if (!osOk || !cpuOk) {
    throw Object.assign(new Error('Unsupported platform'), {
      pkgid: target._id,
      current: {
        os: platform,
        cpu: arch
      },
      required: {
        os: target.os,
        cpu: target.cpu
      },
      code: 'EBADPLATFORM'
    })
  }
}

const checkList = (value, list) => {
  if (typeof list === 'string') {
    list = [list]
  }
  if (list.length === 1 && list[0] === 'any') {
    return true
  }
  // match none of the negated values, and at least one of the
  // non-negated values, if any are present.
  let negated = 0
  let match = false
  for (const entry of list) {
    const negate = entry.charAt(0) === '!'
    const test = negate ? entry.slice(1) : entry
    if (negate) {
      negated ++
      if (value === test) {
        return false
      }
    } else {
      match = match || value === test
    }
  }
  return match || negated === list.length
}

module.exports = {
  checkEngine,
  checkPlatform
}

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642300);
})()
//miniprogram-npm-outsideDeps=["util","semver"]
//# sourceMappingURL=index.js.map